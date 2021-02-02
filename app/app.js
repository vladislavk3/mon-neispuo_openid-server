/* eslint-disable no-console */
require("dotenv").config();

const path = require("path");
const url = require("url");

const set = require("lodash/set");
const express = require("express"); // eslint-disable-line import/no-unresolved
const helmet = require("helmet");
const adapter = require("./adapters/redis");

const { Provider } = require("../lib"); // require('oidc-provider');

const Account = require("./support/account");
const configuration = require("./support/configuration");
const routes = require("./routes/express");

const { PORT = 3000, ROOT_URI } = process.env;
configuration.findAccount = Account.findAccount;

const app = express();
app.use(helmet());

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.static(__dirname + "/public"));

let server;
(async () => {
  const prod = process.env.NODE_ENV === "production";

  if (prod) {
    set(configuration, "cookies.short.secure", true);
    set(configuration, "cookies.long.secure", true);
  }

  const provider = new Provider(ROOT_URI, { adapter, ...configuration });
  provider.Session.prototype.promptedScopesFor = () =>
    new Set(["openid", "offline_access"]); // Remove this if implementing consent for third party RPs. Also adjust configuration.

  if (prod) {
    app.enable("trust proxy");
    provider.proxy = true;

    app.use((req, res, next) => {
      if (req.secure) {
        next();
      } else if (req.method === "GET" || req.method === "HEAD") {
        res.redirect(
          url.format({
            protocol: "https",
            host: req.get("host"),
            pathname: req.originalUrl,
          })
        );
      } else {
        res.status(400).json({
          error: "invalid_request",
          error_description: "connection is not https",
        });
      }
    });
  }

  routes(app, provider);
  app.use(provider.callback);

  server = app.listen(PORT, () => {
    console.log(
      `application is listening on port ${PORT}, check its /.well-known/openid-configuration`
    );
  });
})().catch((err) => {
  if (server && server.listening) server.close();
  console.error(err);
  process.exitCode = 1;
});
