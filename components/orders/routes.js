const express = require('express');
const passport = require('passport');
require('../../utils/auth/strategies/jwt');

const boom = require('@hapi/boom');
const validationIdHandler = require('../../utils/middleware/validationIdHandler');


const OrdersService = require('./ordersService');
const ExamsService = require('../exams/examsService');
const UsersService = require('../users/usersService');
const ResultService = require('../results/resultsService');
const MessagesService = require('../messages/messagesService');
const add = require('date-fns/add');

function ordersApi(app) {
  const router = express.Router();

  app.use('/api/orders', router);

  const ordersService = new OrdersService();
  const examsService = new ExamsService();
  const usersService = new UsersService();
  const resultService = new ResultService();
  const messagesService = new MessagesService();


  router.post(
    '/',
    passport.authenticate('jwt', { session: false }),
    validationIdHandler('patientId', 'body'),
    validationIdHandler('doctorId', 'body'),
    validationIdHandler('examTypeId', 'body'),
    async function (req, res, next) {
      const order = req.body;
      try {
        const createOrderId = await ordersService.createOrder(order);

        const exam = await examsService.getExam(order.examTypeId);

        const message = `${exam.name} test has been scheduled. Already available for more details`;

        await messagesService.createMessages({
          patientId: order.patientId,
          messageText: message,
        });

        res.status(201).json({
          data: createOrderId,
          message: 'Patient test created',
        });
      } catch (error) {
        next(error);
      }
    });

  router.get(
    '/:orderId',
    passport.authenticate('jwt', { session: false }),
    validationIdHandler('orderId'),
    async function (req, res, next) {
      const { orderId } = req.params;

      try {
        const order = await ordersService.getOrder(orderId);

        const response = await (async () => {
          const exam = await examsService.getExam(order.examTypeId);
          const doctor = await usersService.getUserId({
            userId: order.doctorId,
          });
          const patient = await usersService.getUserId({
            userId: order.patientId,
          });
          const result = order.isComplete ? await resultService.getResult(order.resultId) : {};
          const bacteriologist = order.isComplete ? await usersService.getUserId({ userId: result.bacteriologistId }) : {};

          return ({
            _id: order._id,
            name: exam.name,
            shortName: exam.shortName,
            isComplete: order.isComplete,
            doctor: {
              documentID: doctor.documentID,
              firstName: doctor.firstName,
              lastName: doctor.lastName,
            },
            patient: {
              firstName: patient.firstName,
              lastName: patient.lastName,
            },
            appointmentDate: add(
              new Date(order.createdAt),
              { days: exam.scheduledDays }
            ).toISOString(),
            createdAt: order.createdAt,
            ...order.isComplete ? {
              bacteriologist: {
                documentID: bacteriologist.documentID,
                firstName: bacteriologist.firstName,
                lastName: bacteriologist.lastName,
              },
              resultDate: result.createdAt,
              resultId: order.resultId,
            } : {},
          });
        })();

        res.status(200).json({
          data: response,
          message: 'Patient test details retrieved',
        });
      } catch (error) {
        next(error);
      }
    });

  router.get(
    '/',
    passport.authenticate('jwt', { session: false }),
    validationIdHandler('patient', 'query', false),
    async function (req, res, next) {
      const { patient, username, isComplete } = req.query;
      if (!patient && !username) {
        next(boom.badRequest('patient or username query is required'));
        return;
      }

      try {
        const userId = username ? await (async () => {
          const user = await usersService.getUser({ username });
          if (!user) throw boom.notFound('Patient not found');
          return user._id;
        })() : null;

        const query = {};
        query.patient = userId ? userId : patient;
        if (isComplete) {
          query.isComplete = isComplete == 'true';
        }

        const userOrders = await ordersService.getOrders(query);

        const response = await (async () => {
          const orders = await userOrders.map(async order => {
            const exam = await examsService.getExam(order.examTypeId);

            const result = order.isComplete ? await resultService.getResult(order.resultId) : {};

            return ({
              _id: order._id,
              name: exam.name,
              shortName: exam.shortName,
              isComplete: order.isComplete,
              appointmentDate: add(
                new Date(order.createdAt),
                { days: exam.scheduledDays }
              ).toISOString(),
              createdAt: order.createdAt,
              ...order.isComplete ? {
                resultDate: result.createdAt,
                resultId: order.resultId,
              } : {},
            });
          });

          return Promise.all(orders).then(res => res);
        })();
        res.status(200).json({
          data: response,
          message: 'Patient tests retrieved',
        });
      } catch (error) {
        next(error);
      }
    });
}

module.exports = ordersApi;