const { nanoid } = require('nanoid');
const bcrypt = require('bcryptjs');

const knex = require('knex')({
  client: 'mssql',
  // version: '5.7',
  connection: {
    server: 'localhost', // TODO: Move into .env
    database: 'neispuo',
    user: 'sa',
    password: 'Secret123!'
  }
});

async function findLocalUser(username) {
  const userRolesQuery = `select
	su.*, sr.*
from
	neispuo.core.SysUser su
left join neispuo.core.SysUserSysGroup susg on
	su.SysUserID = susg.SysUserID
left join neispuo.core.SysGroupSysRole sgsr on
	susg.SysGroupID = sgsr.SysGroupID
left join neispuo.core.SysRole sr on
  sgsr.SysRoleID = sr.SysRoleID`.replace(/\n/, ' ')

  const users = await knex.queryBuilder().with('userWithRoles', knex.raw(userRolesQuery)).select('*').from('userWithRoles').where('Username', username)
  if (!users || !users.length) {
    return null
  }

  const roles = users.map(u => u.Name)
  const { SysUserID, Username, Password } = users[0]
  return { SysUserID, Username, Password, roles }
}

/**
 * {externalGroupId: localGroupId}
 * TODO: Replace with real mapping. Current value is DSS Azure demo value
 */
const groupMapping = {
  "8a0b9011-6da0-4fc0-9d92-805315a540a2": 1
}

class Account {
  constructor(id, profile) {
    this.accountId = id || nanoid();
    this.profile = profile;
  }

  /**
   * @param use - can either be "id_token" or "userinfo", depending on
   *   where the specific claims are intended to be put in.
   * @param scope - the intended scope, while oidc-provider will mask
   *   claims depending on the scope automatically you might want to skip
   *   loading some claims from external resources etc. based on this detail
   *   or not return them in id tokens but only userinfo and so on.
   */
  async claims(use, scope) { // eslint-disable-line no-unused-vars
    // if (this.profile) {
    return {
      sub: this.accountId, // it is essential to always return a sub claim
      roles: this.profile.roles
      // };
    }

    // Original value
    return {
      sub: this.accountId, // it is essential to always return a sub claim

      address: {
        country: '000',
        formatted: '000',
        locality: '000',
        postal_code: '000',
        region: '000',
        street_address: '000',
      },
      birthdate: '1987-10-16',
      email: 'johndoe@example.com',
      email_verified: false,
      family_name: 'Doe',
      gender: 'male',
      given_name: 'John',
      locale: 'en-US',
      middle_name: 'Middle',
      name: 'John Doe',
      nickname: 'Johny',
      phone_number: '+49 000 000000',
      phone_number_verified: false,
      picture: 'http://lorempixel.com/400/200/',
      preferred_username: 'johnny',
      profile: 'https://johnswebsite.com',
      updated_at: 1454704946,
      website: 'http://example.com',
      zoneinfo: 'Europe/Berlin',
    };
  }

  validatePassword(password) {
    const passwordHash = (this.profile && this.profile.Password) || ''
    return new Promise((resolve, reject) => bcrypt.compare(password, passwordHash, function (err, res) {
      if (err) {
        return reject(err)
      }
      resolve(res)
    }));
  }

  static async findAccount(ctx, id, token) { // eslint-disable-line no-unused-vars
    // token is a reference to the token used for which a given account is being loaded,
    //   it is undefined in scenarios where account claims are returned from authorization endpoint
    // ctx is the koa request context

    const user = await findLocalUser(id)
    return new Account(id, user)
  }

  static async upsertAccount(profile) { // eslint-disable-line no-unused-vars

    let { upn, groups } = profile
    groups = JSON.parse(groups)
    let localUser = await findLocalUser(upn)
    if (!localUser) {
      await knex('neispuo.core.SysUser').insert({ Username: upn })
      localUser = await findLocalUser(upn)
    }
    const localGroups = groups.map(g => groupMapping[g]).filter(v => v)

    if (!localUser || !localUser.SysUserID) {
      throw new Error('No localUser or SysUserID was found')
    }
    // remove previous groups
    await knex('neispuo.core.SysUserSysGroup').where('SysUserID', localUser.SysUserID).delete()

    // add up-to-date groups
    for (const localGroupID of localGroups) {
      await knex('neispuo.core.SysUserSysGroup').insert({ SysUserID: localUser.SysUserID, SysGroupID: localGroupID })
    }

    return findLocalUser(upn)
  }
}

module.exports = Account;
