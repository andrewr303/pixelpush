// Linear client for the capture composer. Uses the workspace and key the
// side panel saved in chrome.storage.local (linearAuth); this file never
// writes credentials. Team metadata is cached for five minutes.
const ENDPOINT = "https://api.linear.app/graphql"
const CACHE_PREFIX = "pixelpushCaptureLinear_"
const CACHE_MS = 5 * 60 * 1000

export class LinearError extends Error {
  constructor(message, auth = false) {
    super(message)
    this.name = "LinearError"
    this.auth = auth
  }
}

export async function workspace() {
  const { linearAuth } = await chrome.storage.local.get("linearAuth")
  const all = linearAuth && typeof linearAuth.workspaces === "object" ? linearAuth.workspaces : {}
  const ws = all[linearAuth?.activeOrgId] || Object.values(all)[0]
  const cred = ws?.credential
  if (!ws || !cred || typeof cred.accessToken !== "string" || !cred.accessToken) return null
  return { orgId: ws.orgId, name: ws.name, auth: cred.kind === "oauth" ? `Bearer ${cred.accessToken}` : cred.accessToken }
}

async function query(ws, q, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: ws.auth },
    body: JSON.stringify({ query: q, variables })
  })
  if (res.status === 401 || res.status === 403) throw new LinearError(`Linear rejected the credential (${res.status}). Reconnect on the side panel's Issue tab.`, true)
  let json
  try {
    json = await res.json()
  } catch {
    throw new LinearError(`Linear returned a non-JSON response (${res.status})`)
  }
  if (json.errors?.length) {
    const message = json.errors[0].message || "Linear returned an error"
    throw new LinearError(message, /authenticat|unauthori[sz]ed|invalid token|access token/i.test(message))
  }
  if (!res.ok) throw new LinearError(`Linear returned ${res.status}`)
  if (!json.data) throw new LinearError("Linear returned no data")
  return json.data
}

async function cached(ws, key, load, fresh = false) {
  const storeKey = `${CACHE_PREFIX}${ws.orgId}`
  const all = (await chrome.storage.local.get(storeKey))[storeKey] || {}
  const hit = all[key]
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value
  try {
    const value = await load()
    const latest = (await chrome.storage.local.get(storeKey))[storeKey] || {}
    latest[key] = { at: Date.now(), value }
    await chrome.storage.local.set({ [storeKey]: latest })
    return value
  } catch (err) {
    if (hit && !err.auth) return hit.value
    throw err
  }
}

export function teams(ws) {
  return cached(ws, "teams", async () => {
    const data = await query(ws, `query PixelpushCaptureTeams { teams(first: 100) { nodes { id name key color } } }`)
    return (data.teams?.nodes || []).sort((a, b) => a.name.localeCompare(b.name))
  })
}

const STATE_ORDER = ["triage", "backlog", "unstarted", "started", "completed", "canceled"]

export function teamMeta(ws, teamId) {
  return cached(ws, `team:${teamId}`, async () => {
    const data = await query(
      ws,
      `query PixelpushCaptureTeam($id: String!) {
        team(id: $id) {
          id name key color
          defaultIssueState { id }
          states(first: 100) { nodes { id name type position color } }
          projects(first: 100) { nodes { id name completedAt canceledAt } }
          members(first: 150) { nodes { id name displayName active } }
          labels(first: 150) { nodes { id name color } }
        }
        issueLabels(first: 150) { nodes { id name color team { id } } }
      }`,
      { id: teamId }
    )
    const t = data.team
    if (!t) throw new LinearError("Linear did not return that team")
    const states = (t.states?.nodes || []).sort(
      (a, b) => STATE_ORDER.indexOf(a.type) - STATE_ORDER.indexOf(b.type) || a.position - b.position
    )
    const teamLabels = t.labels?.nodes || []
    const workspaceLabels = (data.issueLabels?.nodes || []).filter((l) => !l.team)
    const labels = [...teamLabels, ...workspaceLabels.filter((w) => !teamLabels.some((l) => l.id === w.id))]
    return {
      id: t.id,
      name: t.name,
      key: t.key,
      color: t.color,
      defaultStateId: t.defaultIssueState?.id || states.find((s) => s.type === "backlog")?.id || states[0]?.id || null,
      states,
      projects: (t.projects?.nodes || []).filter((p) => !p.completedAt && !p.canceledAt).sort((a, b) => a.name.localeCompare(b.name)),
      members: (t.members?.nodes || []).filter((m) => m.active !== false).sort((a, b) => (a.name || "").localeCompare(b.name || "")),
      labels: labels.map(({ id, name, color }) => ({ id, name, color })).sort((a, b) => a.name.localeCompare(b.name))
    }
  })
}

export async function uploadImage(ws, blob, filename) {
  const data = await query(
    ws,
    `mutation PixelpushCaptureUpload($contentType: String!, $filename: String!, $size: Int!) {
      fileUpload(contentType: $contentType, filename: $filename, size: $size) {
        success
        uploadFile { uploadUrl assetUrl headers { key value } }
      }
    }`,
    { contentType: blob.type || "image/png", filename, size: blob.size }
  )
  const file = data.fileUpload?.uploadFile
  if (!data.fileUpload?.success || !file?.uploadUrl) throw new LinearError("Linear did not accept the screenshot upload")
  const headers = { "Content-Type": blob.type || "image/png", "Cache-Control": "public, max-age=31536000" }
  for (const h of file.headers || []) headers[h.key] = h.value
  const put = await fetch(file.uploadUrl, { method: "PUT", headers, body: blob })
  if (!put.ok) throw new LinearError(`The screenshot upload failed (${put.status})`)
  return file.assetUrl
}

export async function createIssue(ws, input) {
  const data = await query(
    ws,
    `mutation PixelpushCaptureCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id identifier title url team { name } } }
    }`,
    { input }
  )
  const issue = data.issueCreate?.issue
  if (data.issueCreate?.success === false || !issue) throw new LinearError("Linear declined to create the issue")
  return issue
}

export async function attachLink(ws, issueId, url, title) {
  try {
    await query(
      ws,
      `mutation PixelpushCaptureLink($issueId: String!, $url: String!, $title: String) {
        attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success }
      }`,
      { issueId, url, title }
    )
  } catch {}
}
