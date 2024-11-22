/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// import {onRequest} from "firebase-functions/v2/https";
// import * as logger from "firebase-functions/logger";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();

const db = admin.firestore();

// API: Liste aller Universitäten
export const getUniversities = functions.https.onRequest(async (req, res) => {
  try {
    const universitiesSnapshot = await db.collection("universities").get();

    if (universitiesSnapshot.empty) {
      res.status(404).send("No universities found.");
      return;
    }

    const universities = universitiesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json(universities);
  } catch (error) {
    res.status(500).send("Error retrieving universities: " + error.message);
  }
});

