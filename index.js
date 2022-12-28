/* 
Project Name: Feature Request Board
Project Author: Joy Chandra Mollik
Project Start Date: 19/11/2021
Project Type: Feature Request Management
 */

// dependencies
const express = require('express');
const app = express();
const { MongoClient } = require('mongodb');
const admin = require('firebase-admin');
const cors = require('cors');
const ObjectId = require('mongodb').ObjectId;
require('dotenv').config();
const fileUpload = require('express-fileupload');

const port = process.env.PORT || 5001;

// feature-request-board-firebase-adminsdk
// const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// admin.initializeApp({
// 	credential: admin.credential.cert(serviceAccount),
// });

// middleware
app.use(cors());
app.use(express.json());
app.use(fileUpload());

// mongodb initialization
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6vvik.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
	useNewUrlParser: true,
	useUnifiedTopology: true,
});

// middleware for token verification
async function verifyToken(req, res, next) {
	if (req?.headers?.authorization?.startsWith('Bearer ')) {
		const token = req.headers.authorization.split(' ')[1];

		try {
			const decodedUser = await admin.auth().verifyIdToken(token);
			req.decodedEmail = decodedUser.email;
		} catch {}
	}

	next();
}

async function run() {
	try {
		client.connect();

		// initializing database & collections
		const database = client.db('featureRequestBoard');
		const userCollection = database.collection('users');
		const featureRequestCollection = database.collection('featureRequests');
		const commentCollection = database.collection('comments');
		const boardDetailCollection = database.collection('board');

		// users CRUD //

		// sending all the requests
		app.get(`/requests`, async (req, res) => {
			const { page, size } = req.query;

			const count = await featureRequestCollection.countDocuments();

			let cursor;

			if (page && size) {
				cursor = featureRequestCollection
					.find()
					.sort({ _id: -1 })
					.skip(size * (page - 1))
					.limit(Number(size));
			} else {
				cursor = featureRequestCollection.find().sort({ _id: -1 });
			}

			const requests = await cursor.toArray();

			res.send({ count, requests });
		});

		// sending single request
		app.get('/requests/:_id', async (req, res) => {
			const _id = req.params._id;

			const filter = { _id: ObjectId(_id) };

			const request = await featureRequestCollection.findOne(filter);

			res.send(request);
		});

		// sending available comments for a particular feature request
		app.get('/comments/:request_id', async (req, res) => {
			const featureRequestId = req.params.request_id;

			// first of all getting comments id from feature request post
			const query = { _id: ObjectId(featureRequestId) };
			const options = { projection: { comments: 1 } };
			const featureRequestComments =
				await featureRequestCollection.findOne(query, options);

			// now getting all the comments of the feature request post
			const commentList = featureRequestComments.comments;
			const comment_ids = commentList.map((_id) => ObjectId(_id));
			const cursor = commentCollection.find({
				_id: { $in: comment_ids },
			});

			const comments = await cursor.toArray();

			res.send(comments);
		});

		// storing user
		app.post('/user', async (req, res) => {
			const user = req.body;
			console.log(user);

			const result = await userCollection.insertOne(user);

			res.send(result);
		});

		// storing feature request
		app.post('/featureRequest', async (req, res) => {
			const featureRequest = req.body;

			const result = await featureRequestCollection.insertOne(
				featureRequest
			);

			res.send(result);
		});

		// storing client comment
		app.post('/addcomment', async (req, res) => {
			const comment = req.body;

			const result = await commentCollection.insertOne(comment);

			res.send(result);
		});

		// updating voteCounts
		app.put('/updatevotes', async (req, res) => {
			const { request_id, newVotes } = req.body;

			const filter = { _id: ObjectId(request_id) };

			const updateVotes = {
				$set: {
					votes: newVotes,
				},
			};

			const result = await featureRequestCollection.updateOne(
				filter,
				updateVotes
			);

			res.send(result);
		});

		// updating commentCounts on particular feature posts
		app.put('/updatecomments', async (req, res) => {
			const { comment_id, request_id, action } = req.body;

			// first of all getting comments id from feature request post
			const filter = { _id: ObjectId(request_id) };
			const options = { projection: { comments: 1 } };
			const { comments } = await featureRequestCollection.findOne(
				filter,
				options
			);

			// then updating feature request posts comments array
			// action === 1 ? true(add comment_id) : false(remove comment_id)
			let newCommentList = [];
			if (Number(action)) {
				console.log('1');
				newCommentList = [...comments, comment_id];
			} else {
				console.log('0');
				newCommentList = comments.filter(
					(comment) => comment !== comment_id
				);
			}

			const updateComments = {
				$set: {
					comments: newCommentList,
				},
			};

			const result = await featureRequestCollection.updateOne(
				filter,
				updateComments
			);

			res.send(result);
		});

		// storing user signed in with google
		app.put('/adduser', async (req, res) => {
			const user = req.body;

			const filter = { email: user.email };
			const options = { upsert: true };
			const updateUser = { $set: user };
			const result = await userCollection.updateOne(
				filter,
				updateUser,
				options
			);

			res.json(result);
		});

		// deleting comment from collection
		app.delete('/comment/:_id', async (req, res) => {
			const { _id } = req.params;

			const query = { _id: ObjectId(_id) };

			const result = await commentCollection.deleteOne(query);

			res.send(result);
		});

		// admins CRUD //

		// sending query result if email contains role:admin
		app.get('/user/:email', async (req, res) => {
			const email = req.params.email;

			const query = { email: email };
			const user = await userCollection.findOne(query);

			let isAdmin = false;

			if (user?.role === 'admin') {
				isAdmin = true;
			}

			res.json({ admin: isAdmin });
		});

		// getting board details from here
		app.get('/admin/boarddetail', async (req, res) => {
			const cursor = boardDetailCollection.find();
			const boardDetail = await cursor.toArray();

			res.send(boardDetail[0]);
		});

		// making admin if user exists
		app.put('/admin/addadmin', verifyToken, async (req, res) => {
			const user = req.body;
			const requesterEmail = req.decodedEmail;
			console.log('email', requesterEmail);

			// checking if email exists on the database
			if (requesterEmail) {
				const requesterAccount = await userCollection.findOne({
					email: requesterEmail,
				});

				// checking if the email has role admin
				if (requesterAccount.role === 'admin') {
					const filter = { email: user.email };
					const updateUser = { $set: { role: 'admin' } };
					const result = await userCollection.updateOne(
						filter,
						updateUser
					);
					res.json(result);
				}
			} else {
				// default response
				res.status(403).json({
					message: 'You do not have the access to request',
				});
			}
		});

		// updating board logo
		app.put('/admin/boardlogo/:_id', async (req, res) => {
			const _id = req.params._id;
			const logo = req.files.logo;
			const logoData = logo.data;
			const encodedLogo = logoData.toString('base64');
			const imageBuffer = Buffer.from(encodedLogo, 'base64');
			const filter = { _id: ObjectId(_id) };

			const updateLogo = {
				$set: {
					logo: imageBuffer,
				},
			};

			const result = await boardDetailCollection.updateOne(
				filter,
				updateLogo
			);

			res.send(result);
		});

		// updating board title & desc
		app.put('/admin/boarddetail/:_id', async (req, res) => {
			const _id = req.params._id;
			const filter = { _id: ObjectId(_id) };
			const { title, desc } = req.body;

			let updateInfo = {};

			if (title) {
				updateInfo = {
					$set: {
						title: title,
					},
				};
			} else {
				updateInfo = {
					$set: {
						desc: desc,
					},
				};
			}

			const result = await boardDetailCollection.updateOne(
				filter,
				updateInfo
			);

			res.send(result);
		});

		// updating status of the requests
		app.put('/admin/status/:_id', verifyToken, async (req, res) => {
			const status = req.body.status;
			const _id = req.params._id;

			const filter = { _id: ObjectId(_id) };

			const updateRequest = {
				$set: {
					status: status,
				},
			};

			const result = await featureRequestCollection.updateOne(
				filter,
				updateRequest
			);

			res.json(result);
		});

		// delete api to remove particular request post
		app.delete('/admin/request/:_id', async (req, res) => {
			const _id = req.params._id;

			const query = { _id: ObjectId(_id) };
			const result = await featureRequestCollection.deleteOne(query);

			let result2;
			if (result.deletedCount === 1) {
				const query = { request_id: { $regex: _id } };
				result2 = await commentCollection.deleteMany(query);
				res.send(result2);
			}
		});
	} finally {
		await client.close();
	}
}

run().catch(console.dir);

// testing
app.get('/', (req, res) => {
	res.send('Server is running fine');
});

app.listen(port, () => {
	console.log('[RUNNING] server on port: ', port);
});
