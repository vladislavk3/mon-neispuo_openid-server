/* eslint-disable no-console, max-len, camelcase, no-unused-vars */
const { strict: assert } = require("assert");
const querystring = require("querystring");
const { inspect } = require("util");
const { generators } = require("openid-client");

const isEmpty = require("lodash/isEmpty");
const { urlencoded } = require("express"); // eslint-disable-line import/no-unresolved
const express = require("express");

const Account = require("../support/account");
// const azureIntegration = require('../integrations/azure-integration')

const ssHandler = require("../../lib/helpers/samesite_handler");
const instance = require("../../lib/helpers/weak_cache");

const body = urlencoded({ extended: false });

const keys = new Set();
const debug = (obj) =>
  querystring.stringify(
    Object.entries(obj).reduce((acc, [key, value]) => {
      keys.add(key);
      if (isEmpty(value)) return acc;
      acc[key] = inspect(value, { depth: null });
      return acc;
    }, {}),
    "<br/>",
    ": ",
    {
      encodeURIComponent(value) {
        return keys.has(value) ? `<strong>${value}</strong>` : value;
      },
    }
  );

module.exports = (app, provider) => {
  const {
    constructor: {
      errors: { SessionNotFound },
    },
  } = provider;

  app.use((req, res, next) => {
    const orig = res.render;
    // you'll probably want to use a full blown render engine capable of layouts
    res.render = (view, locals) => {
      app.render(view, locals, (err, html) => {
        if (err) throw err;
        orig.call(res, "_layout", {
          ...locals,
          body: html,
        });
      });
    };
    next();
  });

  function setNoCache(req, res, next) {
    res.set("Pragma", "no-cache");
    res.set("Cache-Control", "no-cache, no-store");
    next();
  }
  app.get("/interaction/:uid", setNoCache, async (req, res, next) => {
    try {
      const {
        uid,
        prompt,
        params,
        session,
      } = await provider.interactionDetails(req, res);

      const client = await provider.Client.find(params.client_id);

      switch (prompt.name) {
        case "login": {
          return res.render("login", {
            client,
            uid,
            details: prompt.details,
            params,
            title: "Sign-in",
            session: session ? debug(session) : undefined,
            dbg: {
              params: debug(params),
              prompt: debug(prompt),
            },
          });
        }
        default:
          return undefined;
      }
    } catch (err) {
      return next(err);
    }
  });

  app.post(
    "/interaction/:uid/login",
    setNoCache,
    body,
    async (req, res, next) => {
      try {
        const {
          prompt: { name },
        } = await provider.interactionDetails(req, res);
        return res.redirect(
          `/interaction/${req.params.uid}?error=Invalid username or password.`
        );
        assert.equal(name, "login");
        const account = await Account.findAccount(null, req.body.login, null);
        const passwordValid =
          account.profile &&
          (await account.validatePassword(req.body.password));

        if (!passwordValid) {
          return res.redirect(
            `/interaction/${req.params.uid}?error=Invalid username or password.`
          );
        }

        const result = {
          login: {
            account: account.accountId,
          },
        };

        await provider.interactionFinished(req, res, result, {
          mergeWithLastSubmission: false,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    "/interaction/:uid/login-with-azure",
    setNoCache,
    body,
    async (req, res, next) => {
      try {
        const client = await azureIntegration;
        const code_verifier = generators.codeVerifier();
        const code_challenge = generators.codeChallenge(code_verifier);

        const interactionDetails = await provider.interactionDetails(req, res);
        const { uid, adapter } = interactionDetails;
        await adapter.upsert(`oidc-azure-challenge:${uid}`, code_verifier, 300);

        const cookieOptions = instance(provider).configuration("cookies.short");
        const ctx = provider.app.createContext(req, res);
        ssHandler.set(ctx.cookies, provider.cookieName("interaction"), uid, {
          ...cookieOptions,
          httpOnly: true,
          sameSite: false, // needed as azure does additional requests behind the scenes when client has multiple accounts
        });

        const authUrl = client.authorizationUrl({
          scope: "openid profile email",
          code_challenge,
          code_challenge_method: "S256",
        });
        return res.redirect(authUrl);
      } catch (err) {
        next(err);
      }
    }
  );

  app.get("/azure-integration-callback", async (req, res, next) => {
    const { uid, adapter } = await provider.interactionDetails(req, res);
    const code_verifier = await adapter.find(`oidc-azure-challenge:${uid}`);

    const client = await azureIntegration;
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(
      `${process.env.ROOT_URI}/azure-integration-callback`,
      params,
      { code_verifier }
    );

    const profile = await client.userinfo(tokenSet.access_token);
    await Account.upsertAccount(profile);

    const result = {
      login: {
        account: profile.upn,
      },
    };

    await provider.interactionFinished(req, res, result, {
      mergeWithLastSubmission: false,
    });
  });

  app.use((err, req, res, next) => {
    if (err instanceof SessionNotFound) {
      // handle interaction expired / session not found error
    }
    next(err);
  });
};
