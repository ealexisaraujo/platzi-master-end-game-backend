const MongoLib = require('../../lib/mongo');

const bcrypt = require('bcrypt');
const PasswordGenerator = require('../../lib/password');
const UsernameGenerator = require('../../lib/username');
const MailService = require('../../lib/mail');
const { config } = require('../../config');
const UserModel = require('../../utils/schema/usersSchema');
const boom = require('@hapi/boom');
const validationHandler = require('../../utils/middleware/validationModelHandler');
const emailTemplate = require('../../utils/templates/emailTemplate');

class usersService {
  constructor() {
    this.collection = config.dbCollections.users;
    this.mongoDB = new MongoLib();
    this.generatePassword = new PasswordGenerator();
    this.UsernameGenerator = new UsernameGenerator();
    this.mailService = new MailService();
  }

  async getUser({ username }) {
    const query = username && {
      $or: [{ username: username }, { email: username }],
    };
    const [user] = await this.mongoDB.getAll(this.collection, query);
    return user;
  }

  async getUserId({ userId }) {
    const user = await this.mongoDB.get(this.collection, userId);
    return user || {};
  }

  async getUsers(args) {
    const query = Object.keys(args);

    const search = query.map((criteria) => ({
      [criteria]: args[criteria],
    }));

    const where =
      search.length > 0
        ? {
            $or: search,
          }
        : {};

    const users = await this.mongoDB.getAll(this.collection, where);
    return users || [];
  }

  async createUser({ user }, sendmail = true) {
    await validationHandler(user, UserModel);
    let intentsGenerateUsername = 100;
    const { firstName, lastName, documentID } = user;
    let username = this.UsernameGenerator.build(
      firstName,
      lastName,
      documentID
    );

    const checkUser = await this.mongoDB.getUsername(this.collection, username);
    if (checkUser !== null) {
      while (checkUser.username === username && intentsGenerateUsername) {
        username = this.UsernameGenerator.build(
          firstName,
          lastName,
          this.generatePassword.randomNumberStr(4, 100)
        );
        intentsGenerateUsername -= 1;
      }
      if (intentsGenerateUsername == 0) {
        throw boom.badImplementation(
          'Username cannot generate, try to create again!'
        );
      }
    }

    const passwordSecure = await this.generatePassword.generate();
    if (!this.generatePassword.isSecurity(passwordSecure))
      throw boom.badRequest('Password not secure');

    const hashedPassword = await bcrypt.hash(passwordSecure, 10);

    if (sendmail) {
      const error = await this.mailService.sendMail({
        to: user.email,
        subject: 'Welcome Halah Laboratories',
        html: emailTemplate({ name: firstName, username, passwordSecure }),
      });
      if (error) {
        throw boom.badImplementation(
          'Email cannot send, please check your email registration'
        );
      }
    }

    const createUserId = await this.mongoDB.create(
      this.collection,
      new UserModel({ ...user, password: hashedPassword, username: username })
    );

    return { createUserId, username };
  }

  async createUsers(users) {
    const data = await Promise.all(
      users.map(async (user, index) => {
        try {
          const { createUserId, username } = await this.createUser(
            { user },
            false
          );
          return { id: createUserId, username, error: false };
        } catch (error) {
          return { user: user, index, error: true };
        }
      })
    ).then((res) => {
      return res;
    });
    return data;
  }

  async updateUser({ userId, user }) {
    const updateUserId = await this.mongoDB.update(
      this.collection,
      userId,
      user
    );

    const { username } = await this.getUserId({ userId });

    return updateUserId, username;
  }
}

module.exports = usersService;
