import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type UrlAddress = {
  address: string;
  family: 4 | 6;
};

export type UrlAddressLookup = (hostname: string) => Promise<UrlAddress[]>;

export async function assertAllowedNetworkUrl(inputUrl: string | URL, options: { lookupAddress?: UrlAddressLookup } = {}): Promise<URL> {
  const url = inputUrl instanceof URL ? inputUrl : new URL(inputUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`URL is not allowed: only http and https are supported.`);
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) {
    throw new Error("URL is not allowed: missing hostname.");
  }

  if (process.env.TOKENHUB_ALLOW_PRIVATE_NETWORK === "true") {
    return url;
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`URL is not allowed: ${hostname} resolves to a local network target.`);
  }

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    assertPublicAddress({ address: hostname, family: literalFamily as 4 | 6 }, hostname);
    return url;
  }

  const resolveAddress = options.lookupAddress ?? defaultLookupAddress;
  let addresses: UrlAddress[];
  try {
    addresses = await resolveAddress(hostname);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`URL is not allowed: could not verify ${hostname} DNS addresses (${message}).`);
  }
  if (addresses.length === 0) {
    throw new Error(`URL is not allowed: ${hostname} did not resolve to any addresses.`);
  }
  for (const address of addresses) {
    assertPublicAddress(address, hostname);
  }

  return url;
}

async function defaultLookupAddress(hostname: string): Promise<UrlAddress[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((address) => ({ address: address.address, family: address.family as 4 | 6 }));
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[(.*)]$/, "$1").toLowerCase();
}

function assertPublicAddress(address: UrlAddress, hostname: string): void {
  const normalized = normalizeHostname(address.address);
  if (address.family === 4 && isPrivateIpv4(normalized)) {
    throw new Error(`URL is not allowed: ${hostname} resolves to private address ${normalized}.`);
  }
  if (address.family === 6 && isPrivateIpv6(normalized)) {
    throw new Error(`URL is not allowed: ${hostname} resolves to private address ${normalized}.`);
  }
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true;
  const mappedIpv4 = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4 && isPrivateIpv4(mappedIpv4)) return true;
  return false;
}
