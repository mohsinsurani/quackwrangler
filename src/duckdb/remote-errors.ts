import { isRemoteDataSource, redactRemoteText } from '../utils/remoteProgress.js';

/** The address without its query string or fragment, which can hold signed tokens. */
function safeAddress(source: string): string {
  try {
    const url = new URL(source);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return source.split(/[?#]/)[0];
  }
}

function fileKind(source: string): string {
  const pathname = safeAddress(source).toLowerCase();
  if (pathname.endsWith('.parquet')) return 'Parquet';
  if (/\.(json|jsonl|ndjson)$/.test(pathname)) return 'JSON';
  return 'data';
}

/**
 * Turns DuckDB's raw HTTP and S3 failures into one clear sentence. DuckDB's own text includes SQL
 * fragments, internal relation names, and the full URL (query string included), none of which help
 * the user or belong in a message that may be copied into a bug report. Local files and errors that
 * are not about remote access are returned unchanged.
 */
export function describeRemoteError(error: unknown, source: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (!isRemoteDataSource(source)) return redactRemoteText(raw);
  const isS3 = /^s3:\/\//i.test(source);
  const address = safeAddress(source);
  const status = /\(HTTP (\d{3})\b/i.exec(raw)?.[1] ?? /returned HTTP (\d{3})\b/i.exec(raw)?.[1];

  if (status === '404')
    return `The remote file was not found (404): ${address}. Check the address${isS3 ? ', bucket, and region' : ''} and that the file still exists.`;
  if (status === '403')
    return isS3
      ? `Access was denied (403) to ${address}. If this bucket is private, QuackWrangler uses the AWS credentials available to VS Code: the AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables, or the default profile in ~/.aws (set AWS_PROFILE before starting VS Code to use another). Those credentials were missing or are not allowed to read this object.`
      : `Access was denied (403) to ${address}. The server refuses this request; the link may have expired or may need permission.`;
  if (status === '401')
    return `The server asked for sign-in (401 Unauthorized) for ${address}. QuackWrangler cannot send a login; use a public or pre-signed link, or download the file first.`;
  if (status && /^5\d\d$/.test(status))
    return `The server returned an error (${status}) for ${address}. It may be down or overloaded; try again in a moment.`;
  if (/timeout was reached|timed out/i.test(raw))
    return `The request to ${address} timed out. Check your connection, or try again if the server is slow.`;
  if (/could not resolve host|name or service not known|getaddrinfo/i.test(raw))
    return `Could not reach ${new URL(address).host}. Check the address and your network connection.`;
  if (/certificate|ssl|tls/i.test(raw))
    return `A secure connection to ${address} could not be established (certificate problem).`;
  if (/no magic bytes found/i.test(raw))
    return `${address} is not a valid Parquet file. The link may return a web page (such as a sign-in or error page) instead of the data.`;
  if (/malformed json|unexpected character|invalid json/i.test(raw))
    return `${address} is not valid JSON. The link may return a web page instead of the data.`;
  if (/http error|http (get|head)/i.test(raw))
    return `Could not read ${fileKind(source)} data from ${address}: ${raw
      .split('\n')[0]
      .replace(/https?:\/\/[^\s'"]+|s3:\/\/[^\s'"]+/gi, '<address>')
      .replace(/^Error:\s*/i, '')
      .slice(0, 160)}`;
  // Anything else is shown as DuckDB wrote it, minus credentials in any address it mentions.
  return redactRemoteText(raw);
}
