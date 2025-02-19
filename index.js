require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_INTENT_SECRET_KEY);
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ezm1s.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // database and collections
    const userCollection = client.db("PetPromise").collection("users");
    const petCollection = client.db("PetPromise").collection("pet_data");
    const requestedPets = client.db("PetPromise").collection("requested-pets");
    const donationCampaigns = client
      .db("PetPromise")
      .collection("donation-campaigns");
    const donations = client.db("PetPromise").collection("donation-history");

    // jwt api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "3h",
      });
      res.send({ token });
    });

    // verify token
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "Forbidden Access" });
      }

      const token = req.headers.authorization.split(" ")[1];

      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "Forbidden Access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);

      const isAdmin = user?.role === "Admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };

    // GET OPERATIONS
    // GET operation for pet listing with pagination
    app.get("/pet-listing", async (req, res) => {
      const { sortByCategory, searchQuery, page = 1, limit = 10 } = req.query;

      // Initialize the filter object
      const filter = { adopted: false };

      // Filter by category if provided
      if (sortByCategory) {
        filter.pet_category = sortByCategory;
      }

      // Search by pet name if provided
      if (searchQuery) {
        filter.pet_name = { $regex: searchQuery, $options: "i" };
      }

      // Convert page and limit to numbers
      const pageNumber = parseInt(page, 10);
      const limitNumber = parseInt(limit, 10);

      try {
        // Get the total count of documents matching the filter
        const totalPets = await petCollection.countDocuments(filter);

        // Fetch pets with pagination
        const pets = await petCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .skip((pageNumber - 1) * limitNumber)
          .limit(limitNumber)
          .toArray();

        // Check if there are more pets for the next page
        const hasMore = pageNumber * limitNumber < totalPets;

        // Respond with paginated data
        res.send({
          pets,
          currentPage: pageNumber,
          totalPets,
          totalPages: Math.ceil(totalPets / limitNumber),
          hasMore,
        });
      } catch (error) {
        console.error("Error fetching pets:", error);
        res.status(500).send({ error: "Failed to fetch pet listings" });
      }
    });

    // get operation for pet details page
    app.get("/pet-details/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await petCollection.findOne(query);
      res.send(result);
    });

    // get operation for registered users(secured)
    app.get("/all-users", verifyToken, verifyAdmin, async (req, res) => {
      const reqEmail = req.query.email;

      const page = parseInt(req.query.page) || 1;
      const pageSize = 10;

      const filter = { email: { $ne: reqEmail } };
      const totalUsers = await userCollection.countDocuments(filter);
      const cursor = userCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize);

      const users = await cursor.toArray();

      res.send({ users, totalUsers });
    });

    // get operation for user role
    app.get("/user-role", verifyToken, async (req, res) => {
      const reqEmail = req?.query.email;
      if (reqEmail !== req.decoded.email) {
        return res.status(403).send({ message: "Unauthorized access" });
      }

      const filter = { email: reqEmail };
      const cursor = userCollection.find(filter);
      const result = await cursor.toArray();

      if (result && result.length > 0) {
        res?.send(result[0]?.role);
      } else {
        res.status(404).send({ message: "User not found" });
      }
    });

    // get operation for my added pets route
    app.get("/my-added-pets", verifyToken, async (req, res) => {
      const currentUserEmail = req.query.email;
      const page = parseInt(req.query.page) || 1; // Default to page 1
      const limit = parseInt(req.query.limit) || 8; // Default to 8 items per page

      if (!currentUserEmail) {
        return res.status(404).send({ message: "RESOURCE NOT FOUND" });
      }

      if (currentUserEmail !== req.decoded.email) {
        return res.status(403).send({ message: "Unauthorized access" });
      }

      const filter = { currentUserEmail: currentUserEmail };
      const cursor = petCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      const result = await cursor.toArray();
      const totalPets = await petCollection.countDocuments(filter);

      res.send({ result, totalPets });
    });

    // get operation for all pets route
    app.get("/all-pets", verifyToken, verifyAdmin, async (req, res) => {
      const currentUserEmail = req.query.email;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 5;
      const skip = (page - 1) * limit;

      const filter = { currentUserEmail: { $ne: currentUserEmail } };
      const total = await petCollection.countDocuments(filter);
      const cursor = petCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
      const result = await cursor.toArray();

      res.send({ total, pets: result });
    });

    // get operation for getting adoption request route data
    app.get("/adoption-requests", verifyToken, async (req, res) => {
      const userEmail = req.query.email;

      if (userEmail !== req.decoded.email) {
        return res.status(403).send({ message: "Unauthorized access" });
      }

      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 5;
      const skip = (page - 1) * limit;

      const filter = {
        owner_email: userEmail,
        isRequested: true,
      };

      const total = await requestedPets.countDocuments(filter);

      const result = await requestedPets
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
      res.send({ total, result });
    });

    // get operation for getting donation campaigns data
    app.get("/donation-campaigns", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const skip = (page - 1) * limit;

        const cursor = donationCampaigns
          .find()
          .sort({ campaignAddedDate: -1 })
          .skip(skip)
          .limit(limit);
        const campaigns = await cursor.toArray();

        const today = new Date();

        const updatedCampaigns = campaigns.map((campaign) => ({
          ...campaign,
          expired: new Date(campaign.lastDate) < today,
        }));

        res.send(updatedCampaigns);
      } catch (error) {
        console.error("Error fetching campaigns:", error);
        res.status(500).send({ message: "Failed to fetch campaigns." });
      }
    });

    // get operation for getting recommended donation campaign
    app.get("/recommended-donation/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const currentDate = new Date();

        // Fetch random 3 campaigns excluding the current one
        const campaigns = await donationCampaigns
          .aggregate([
            {
              $match: {
                _id: { $ne: new ObjectId(id) },
                lastDate: { $gte: currentDate.toISOString() },
                isPaused: false,
              },
            },
            { $sample: { size: 3 } },
          ])
          .toArray();

        const updatedCampaigns = campaigns.map((campaign) => ({
          ...campaign,
          expired: new Date(campaign.lastDate) < currentDate,
        }));

        res.send(updatedCampaigns);
      } catch (error) {
        console.error("Error fetching recommended donations:", error);
        res
          .status(500)
          .send({ message: "Error fetching recommended donations" });
      }
    });

    // get operation for getting recommended donation campaign for homepage
    app.get("/recommended-donation-homePage", async (req, res) => {
      try {
        const currentDate = new Date();

        // Fetch campaigns
        const campaigns = await donationCampaigns
          .find({
            lastDate: { $gte: currentDate.toISOString() },
            isPaused: false,
          })
          .toArray();

        const updatedCampaigns = campaigns.map((campaign) => ({
          ...campaign,
          expired: new Date(campaign.lastDate) < currentDate,
        }));

        res.send(updatedCampaigns);
      } catch (error) {
        console.error("Error fetching recommended donations:", error);
        res
          .status(500)
          .send({ message: "Error fetching recommended donations" });
      }
    });

    // get operation for donation campaign details page
    app.get("/donation-details-page-data/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await donationCampaigns.findOne(filter);

      if (result) {
        const today = new Date();
        result.expired = new Date(result.lastDate) < today;
      }

      res.send(result);
    });

    // get operation for my campaigns
    app.get("/my-campaign-data", verifyToken, async (req, res) => {
      const email = req.query.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "Unauthorized access" });
      }

      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 6;

      const query = { currentUserEmail: email };
      const skip = (page - 1) * limit;

      const result = await donationCampaigns
        .find(query)
        .sort({ campaignAddedDate: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
      totalCampaigns = await donationCampaigns.countDocuments(query);

      const today = new Date();
      const updatedResult = result.map((campaign) => ({
        ...campaign,
        expired: new Date(campaign.lastDate) < today,
      }));

      res.send({
        campaigns: updatedResult,
        totalCampaigns,
      });
    });

    // get operation for my campaigns(admin)
    app.get("/all-campaign-data",verifyToken, verifyAdmin, async (req, res) => {
        const email = req.query.email;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;

        const query = { currentUserEmail: { $ne: email } };
        const skip = (page - 1) * limit;

        const result = await donationCampaigns
          .find(query)
          .sort({ campaignAddedDate: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();
        const totalCampaigns = await donationCampaigns.countDocuments(query);

        const today = new Date();
        const updatedResult = result.map((campaign) => ({
          ...campaign,
          expired: new Date(campaign.lastDate) < today,
        }));

        res.send({
          campaigns: updatedResult,
          totalCampaigns,
        });
      }
    );

    // get operation for donation confirmation
    app.get("/payment-confirmation/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { transaction_id: id };
      const result = await donations.findOne(filter);
      res.send(result);
    });

    // get operations for donations
    app.get("/donators/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { campaign_id: id };
      const result = await donations
        .find(filter)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    // get operation for donation history
    app.get("/donation-history", verifyToken, async (req, res) => {
      const email = req.query.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "Unauthorized access" });
      }

      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 6;

      const filter = { email: email };
      const skip = (page - 1) * limit;

      const result = await donations
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
      const total = await donations.countDocuments(filter);
      res.send({ result, total });
    });

    // POST OPERATIONS
    // post operation for users
    app.post("/users", async (req, res) => {
      const user = req.body;

      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);

      // checking if user exists.
      if (existingUser) {
        return res.send({ message: "USER ALREADY EXISTS", insertedId: null });
      }

      // user added with current added time
      const userToBeAdded = {
        ...user,
        createdAt: new Date(),
        role: "User",
      };
      const result = await userCollection.insertOne(userToBeAdded);
      res.send(result);
    });

    // post api for add a pet
    app.post("/add-a-pet", verifyToken, async (req, res) => {
      const thePetToBeAddedIntoDatabase = req.body;

      const { currentUserEmail } = thePetToBeAddedIntoDatabase;

      if (currentUserEmail !== req.decoded.email) {
        return res.status(403).send({ message: "Unauthorized access" });
      }

      if (!thePetToBeAddedIntoDatabase) {
        return res.send({ message: "Resource not found" });
      }

      const finalPetDataToAdd = {
        ...thePetToBeAddedIntoDatabase,
        createdAt: new Date(),
        adopted: false,
        isRequested: false,
      };

      const result = await petCollection.insertOne(finalPetDataToAdd);
      res.send(result);
    });

    // post api for adding requested pets
    app.post("/requested-pets/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { requestorEmail } = req.body;
      const requestedPet = req.body;

      if (requestorEmail !== req.decoded.email) {
        return res.status(403).send({ message: "Unauthorized access" });
      }

      const query = {
        requestorEmail: requestorEmail,
        pet_id: id,
      };

      const existingRequest = await requestedPets.findOne(query);

      if (existingRequest) {
        return res.send({ message: "ALREADY REQUESTED" });
      }

      if (!requestedPet) {
        res.send({ message: "Resource not found" });
      }

      const finalRequestedPet = {
        ...requestedPet,
        isRequested: true,
        adopted: false,
        createdAt: new Date(),
      };

      const result = await requestedPets.insertOne(finalRequestedPet);

      res.send(result);
    });

    // post operation for add a campaign
    app.post("/post-campaign", verifyToken, async (req, res) => {
      const campaignData = req.body;
      const { lastDate } = req.body;
      const { currentUserEmail } = campaignData;

      if (currentUserEmail !== req.decoded.email) {
        return res.status(403).send({ message: "Unauthorized access" });
      }
      if (!campaignData) {
        return res.send({ message: "Resource not found!" });
      }

      const result = await donationCampaigns.insertOne(campaignData);
      res.send(result);
    });

    // payment intents
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { donationAmount } = req.body;
      const amount = parseInt(donationAmount * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // post operations for donation history
    app.post("/donations", verifyToken, async (req, res) => {
      const donationData = req.body;

      const { email } = donationData;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "Unauthorized access" });
      }

      if (!donationData) {
        return res.send({ message: "RESOURCE NOT FOUND" });
      }

      const finalData = {
        ...donationData,
        createdAt: new Date(),
      };

      const result = await donations.insertOne(finalData);

      res.send(result);
    });

    // PUT OPERATIONS
    // put operation for tables
    app.put("/update-pets/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const dataToBeUpdated = req.body;

      if (!dataToBeUpdated) {
        return res.status(404).send({ message: "Resource Not Found" });
      }

      try {
        // Fetch the existing document from the database
        const existingDoc = await petCollection.findOne(filter);

        if (!existingDoc) {
          return res.status(404).send({ message: "Pet not found" });
        }

        // Compare each field
        let allFieldsMatch = true;
        for (const key in dataToBeUpdated) {
          if (dataToBeUpdated[key] !== existingDoc[key]) {
            allFieldsMatch = false;
            break;
          }
        }

        if (allFieldsMatch) {
          return res.send({ message: "No changes detected, all fields match" });
        }

        // Proceed with the update if any field doesn't match
        const updatedDoc = {
          $set: dataToBeUpdated,
        };

        const result = await petCollection.updateOne(filter, updatedDoc);

        res.send(result);
      } catch (error) {
        console.error("Error updating pet:", error);
        res
          .status(500)
          .send({ message: "An error occurred while updating the pet" });
      }
    });

    // put operation for update campaigns
    app.put("/update-campaign/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedData = req.body;

      if (!updatedData) {
        return res.status(404).send({ message: "Resource Not Found" });
      }

      const existingDoc = await donationCampaigns.findOne(filter);

      if (!existingDoc) {
        return res.status(404).send({ message: "Pet not found" });
      }

      // Compare each field
      let allFieldsMatch = true;

      for (const key in updatedData) {
        const existingValue = existingDoc[key];
        const updatedValue = updatedData[key];

        // Normalize both values to string for comparison
        if (String(existingValue) !== String(updatedValue)) {
          allFieldsMatch = false;
          break;
        }
      }

      if (allFieldsMatch) {
        return res.send({ message: "No changes detected, all fields match" });
      }

      const updatedDoc = {
        $set: updatedData,
      };

      const result = await donationCampaigns.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // PATCH OPERATIONS
    // patch operation for make a user admin in dashboard user tab
    app.patch("/make-admin/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const updatedRole = req.body;

      try {
        // checking if update role exist
        if (!updatedRole) {
          return res.status(404).json({ message: "Resource not found" });
        }

        const result = await userCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: updatedRole },
          { new: false, upsert: false }
        );

        res.status(200).json({
          message: "User updated with role 'Admin'",
          updatedUserRole: true,
        });
      } catch (error) {
        console.error("Error Making Admin", error);
        res.status(500).json({ message: "Something went wrong", error });
      }
    });

    // patch api for tables
    app.patch("/change-pet-status/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const updatedStatus = req.body;

      try {
        if (!updatedStatus) {
          return req.send({ message: "Resource Not Found" });
        }

        const result = await petCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: updatedStatus },
          { upsert: false }
        );
        res.send({ message: "Pet status updated", updated: true });
      } catch {
        console.error("Error changing pet status");
      }
    });

    // patch api for changing the request status
    app.patch(
      "/change-status-to-requested/:id",
      verifyToken,
      async (req, res) => {
        const id = req.params.id;
        const updatedRequestedStatus = req.body;

        if (!updatedRequestedStatus) {
          return res.send({ message: "Resource not found" });
        }

        const result = await petCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: updatedRequestedStatus },
          { upsert: false }
        );
        res.send({ message: "Pet request status updated", updated: true });
      }
    );

    // patch api for changing the adopted status on accepting request
    app.patch("/accept-request-change-adoptedStatus/:id", verifyToken, async (req, res) => {
        const id = req.params.id;
        const updatedAdoptedStatus = req.body;

        if (!updatedAdoptedStatus) {
          return res.send({ message: "Resource not found" });
        }

        const result = await petCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: updatedAdoptedStatus },
          { upsert: false }
        );

        res.send({ message: "Pet adopted status updated", updated: true });
      }
    );

    // patch api for changing the adopted status on accepting request
    app.patch("/accept-request-change-reqStatus-petCollection/:id", verifyToken, async (req, res) => {
        const id = req.params.id;
        const updatedReqStatus = req.body;

        if (!updatedReqStatus) {
          return res.send({ message: "Resource not found" });
        }

        const result = await petCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: updatedReqStatus },
          { upsert: false }
        );

        res.send({ message: "Pet adopted status updated", updated: true });
      }
    );

    // patch api for changing the request status
    app.patch("/accept-request-change-reqStatus/:id", verifyToken, async (req, res) => {
        const id = req.params.id;
        const updatedRequestedStatus = req.body;

        if (!updatedRequestedStatus) {
          return res.send({ message: "Resource not found" });
        }

        const result = await requestedPets.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: updatedRequestedStatus },
          { upsert: false }
        );
        res.send({ message: "Pet request status updated", updated: true });
      }
    );

    // patch api for changing the adopted status on accepting request
    app.patch("/accept-request-change-adoptedStatus-requestedPets/:id", verifyToken, async (req, res) => {
        const id = req.params.id;
        const updatedAdoptedStatus = req.body;

        if (!updatedAdoptedStatus) {
          return res.send({ message: "Resource not found" });
        }

        const result = await requestedPets.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: updatedAdoptedStatus },
          { upsert: false }
        );

        res.send({ message: "Pet adopted status updated", updated: true });
      }
    );

    // patch api for changing the request status on rejecting request in petCollection
    app.patch("/reject-request-status-change/:id", verifyToken, async (req, res) => {
        const id = req.params.id;
        const updatedRequestedStatus = req.body;

        if (!updatedRequestedStatus) {
          return res.send({ message: "Resource not found" });
        }

        const result = await petCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: updatedRequestedStatus },
          { upsert: false }
        );
        res.send({ message: "Pet request status updated", updated: true });
      }
    );

    // patch api for change status of isPaused
    app.patch("/change-isPaused-status/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const updatedStatus = req.body;
      if (!id) {
        res.send({
          message: "COULDN'T GET THE ID WHILE PERFORMING THE ACTION",
        });
      }

      if (!updatedStatus) {
        res.send({ message: "RESOURCE NOT FOUND" });
      }

      const result = await donationCampaigns.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updatedStatus },
        { upsert: false }
      );

      res.send({ message: "STATUS UPDATED", updated: true });
    });

    // patch api for change total donated amount
    app.patch("/change-donated-amount/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const updatedTotalAmount = req.body;

      if (!id) {
        res.send({
          message: "COULDN'T GET THE ID WHILE PERFORMING THE ACTION",
        });
      }

      if (!updatedTotalAmount) {
        res.send({ message: "TOTAL AMOUNT NOT FOUND" });
      }

      const result = await donationCampaigns.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updatedTotalAmount },
        { upsert: false }
      );

      res.send({ message: "TOTAL AMOUNT UPDATED", updated: true });
    });

    // patch api for change the donated amount after refund
    app.patch("/amount-change-for-refund/:id", verifyToken, async (req, res) => {
        const id = req.params.id;
        const changedAmount = req.body;

        if (!changedAmount) {
          res.send({ message: "Resource not found" });
        }
        const result = await donationCampaigns.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: changedAmount },
          { upsert: false }
        );

        res.send({ message: "Amount updated successfully", updated: true });
      }
    );

    // DELETE OPERATIONS
    // delete api for my added pets
    app.delete("/delete-pet/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await petCollection.deleteOne(query);
      res.send(result);
    });

    // delete api for reject request
    app.delete("/reject-request/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await requestedPets.deleteOne(filter);
      res.send(result);
    });

    // delete api for delete campaign (only for admin)
    app.delete("/delete-campaign/:id", verifyToken, verifyAdmin, async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const result = await donationCampaigns.deleteOne(filter);
        res.send(result);
      }
    );

    // delete api for delete donation payment info
    app.delete("/delete-payment-after-refund/:id", verifyToken, async (req, res) => {
        const id = req.params.id;
        const filter = { transaction_id: id };
        const result = await donations.deleteOne(filter);
        res.send(result);
      }
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (res) => {
  res.send("petpromise is running");
});

app.listen(port, () => {
  console.log(`petpromise is running on port ${port}`);
});
