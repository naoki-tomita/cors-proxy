const port = Number.parseInt(Deno.env.get("PORT")!);
const server = Deno.listen({ port });
console.log(`Listening port on ${port}`);


const proxy = new URL(Deno.env.get("PROXY")!);
for await (const conn of server) {
  serveHttp(conn);
}

function overwriteHeadersWithAccessControlAllow(origin: string, headers: Headers): Headers {
  headers.set("access-control-allow-headers", "origin,x-requested-with,content-type,accept,range,x-xsrf-token")
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET,HEAD,POST");
  headers.set("access-control-allow-credentials", "true");
  return headers
}

function handleOptions(requestEvent: Deno.RequestEvent) {
  const headers = new Headers();

  requestEvent.respondWith(new Response(null, {
    status: 204,
    headers: overwriteHeadersWithAccessControlAllow(requestEvent.request.headers.get("origin")!, headers)
  }));
}

function copyHeaders(headers: Headers): Headers {
  return [...headers.entries()].reduce((h, [k, v]) => (h.append(k, v), h), new Headers());
}

function createRequest(requestEvent: Deno.RequestEvent): {
  url: string;
  fetchInit: {
    method: string;
    headers: Headers;
    body: BodyInit | null | undefined;
  }
} {
  const url = new URL(requestEvent.request.url);
  const path = url.href.replace(url.origin, "");
  const headers = copyHeaders(requestEvent.request.headers);

  headers.set("origin", proxy.origin);

  return {
    url: `${proxy.origin}${path}`,
    fetchInit: {
      method: requestEvent.request.method,
      headers,
      body: requestEvent.request.method.toUpperCase() === "GET" ? undefined : requestEvent.request.body,
    }
  }
}

async function serveHttp(conn: Deno.Conn) {
  const httpConn = Deno.serveHttp(conn);
  for await (const requestEvent of httpConn) {
    console.time(`${requestEvent.request.method} ${requestEvent.request.url}`);
    switch (requestEvent.request.method.toUpperCase()) {
      case "OPTIONS": {
        handleOptions(requestEvent);
        break;
      }
      default: {
        // request
        const { url, fetchInit } = createRequest(requestEvent);
        const response = await fetch(url, fetchInit);

        // wrap response.
        const headers = copyHeaders(response.headers);
        const overwrittenHeaders = overwriteHeadersWithAccessControlAllow(requestEvent.request.headers.get("origin")!, headers);
        const responseInit = {
          status: response.status,
          headers: overwrittenHeaders,
        }
        requestEvent.respondWith(new Response(response.body, responseInit));
      }
    }
    console.timeEnd(`${requestEvent.request.method} ${requestEvent.request.url}`);
  }
}
