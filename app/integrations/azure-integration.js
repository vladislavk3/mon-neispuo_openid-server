const { Issuer } = require('openid-client');

module.exports = Issuer.discover(process.env.CLIENT_DISCOVERY).then(azureIssuer => {
  // console.log('Discovered issuer %s %O', azureIssuer.issuer, azureIssuer.metadata);
  return new azureIssuer.Client({
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    redirect_uris: [`${process.env.ROOT_URI}/azure-integration-callback`],
    response_types: ['code'],
    // id_token_signed_response_alg (default "RS256")
    // token_endpoint_auth_method (default "client_secret_basic")
})}) // => Client);