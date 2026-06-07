const fs = require("fs");
const http = require("http");
const https = require("https");

const listenHost = process.env.KPI_HTTPS_HOST || "127.0.0.1";
const listenPort = Number(process.env.KPI_HTTPS_PORT || 8788);
const upstreamHost = process.env.KPI_GATEWAY_HOST || "127.0.0.1";
const upstreamPort = Number(process.env.KPI_GATEWAY_PORT || 8787);
const certPath = process.env.KPI_TLS_CERT || "E:\\PUAsimulator\\certs\\yhaox.top_bundle.crt";
const keyPath = process.env.KPI_TLS_KEY || "E:\\PUAsimulator\\certs\\yhaox.top.key";

function proxyRequest(req, res) {
  const upstreamHeaders = { ...req.headers, host: `${upstreamHost}:${upstreamPort}` };
  const upstream = http.request(
    {
      host: upstreamHost,
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers: upstreamHeaders,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstream.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    }
    res.end(JSON.stringify({ error: "upstream_unavailable", message: error.message }));
  });

  req.pipe(upstream);
}

const server = https.createServer(
  {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  },
  proxyRequest
);

server.requestTimeout = 0;
server.headersTimeout = 65000;
server.keepAliveTimeout = 65000;

server.listen(listenPort, listenHost, () => {
  console.log(
    JSON.stringify({
      ok: true,
      https_proxy: `https://${listenHost}:${listenPort}`,
      upstream: `http://${upstreamHost}:${upstreamPort}`,
      cert: certPath,
    })
  );
});
