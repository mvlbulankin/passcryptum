// No hardcoded host: the API base is a build-time override
// (VITE_API_BASE_URL), defaulting to the origin the app is served from —
// which is exactly where the Go backend answers (ADR-0001 single binary).

const getApiBase = (): string => {
  const env = import.meta.env.VITE_API_BASE_URL

  if (typeof env === 'string' && env.length > 0) {
    return env.replace(/\/+$/, '')
  }

  return typeof location !== 'undefined'
    ? location.origin
    : 'http://localhost:8000'
}

export const profilesUrl = (): string => `${getApiBase()}/api/profiles/`

export const credentialsUrl = (): string => `${getApiBase()}/api/credentials/`
