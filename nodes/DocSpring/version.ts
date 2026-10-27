// The package version, sent in every request's User-Agent so DocSpring's API logs can count n8n users.
// Keep it in step with package.json (a test checks it).
export const PACKAGE_VERSION = '1.0.0';

export const USER_AGENT = `docspring-n8n/${PACKAGE_VERSION}`;

// The last release on API v1, for self-hosted DocSpring servers that don't have API v2 yet.
export const LAST_API_V1_VERSION = '0.1.4';

export const NO_API_V2_MESSAGE = `This DocSpring server doesn't have API v2 yet. Upgrade it to the latest release, or use version ${LAST_API_V1_VERSION} of this integration.`;
