

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore"; // Import Firestore-spezifischer Methoden


admin.initializeApp();

const db = admin.firestore();

// Verbindung zu Emulatoren nur in Entwicklungsumgebung herstellen
if (process.env.FUNCTIONS_EMULATOR) {
  db.settings({
    host: "localhost:8080",
    ssl: false,
  });
}


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


// API: Eine neue Universität erstellen
export const createUniversity = functions.https.onRequest(async (req, res) => {
  try {
    const { name, location } = req.body;

    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    const universityRef = await db.collection("universities").add({ name, location });

    res.status(201).json({
      id: universityRef.id,
      message: "University created",
    });
  } catch (error) {
    res.status(500).json({ error: "Error creating university: " + error.message });
  }
});

// API: einen neuen Kurs erstellen
export const createCourse = functions.https.onRequest(async (req, res) => {
  try {
    const { universityId, name } = req.body;

    if (!universityId || !name) {
      res.status(400).json({ error: "universityId and name are required" });
      return;
    }

    const universityRef = db.collection("universities").doc(universityId);

    // Speichere die University als Reference
    const courseRef = await db.collection("courses").add({ universityRef, name });

    res.status(201).json({ id: courseRef.id, message: "Course created" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// API: Kurse zu einer Universität abrufen
export const getCourses = functions.https.onRequest(async (req, res) => {
  try {
    const { universityId } = req.query;

    if (!universityId || typeof universityId !== "string") {
      res.status(400).json({ error: "universityId must be provided and must be a string" });
      return;
    }

    const universityRef = db.collection("universities").doc(universityId);

    // Finde Kurse mit der passenden Referenz
    const coursesSnapshot = await db.collection("courses")
      .where("universityRef", "==", universityRef)
      .get();

    if (coursesSnapshot.empty) {
      res.status(404).json({ error: "No courses found for the given university" });
      return;
    }

    const courses = coursesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json(courses);
  } catch (error) {
    res.status(500).json({ error: "Error retrieving courses: " + error.message });
  }
});




// API: Einen neuen Nutzer erstellen
export const createUser = functions.https.onRequest(async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    // Nutzer erstellen
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName,
    });

    // Zusätzliche Nutzerdaten in Firestore speichern
    await db.collection("users").doc(userRecord.uid).set({
      email,
      displayName,
      createdAt: FieldValue.serverTimestamp(), // Explizit importiert
    });

    res.status(201).json({
      uid: userRecord.uid,
      message: "User created successfully",
    });
  } catch (error) {
    res.status(500).json({ error: "Error creating user: " + error.message });
  }
});

// API: Nutzerdaten abrufen
export const getUserData = functions.https.onRequest(async (req, res) => {
  try {
    const { uid } = req.query;

    if (!uid) {
      res.status(400).json({ error: "User ID (uid) is required" });
      return;
    }

    // Nutzerdaten aus Firestore abrufen
    const userDoc = await db.collection("users").doc(uid as string).get();

    if (!userDoc.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.status(200).json(userDoc.data());
  } catch (error) {
    res.status(500).json({ error: "Error fetching user data: " + error.message });
  }
});


exports.joinCourse = functions.https.onRequest(async (req, res) => {
  try {
    const { userId, courseId } = req.body;

    if (!userId || !courseId) {
      res.status(400).json({ error: "userId and courseId are required" });
      return;
    }

    const userRef = db.collection("users").doc(userId);
    const courseRef = db.collection("courses").doc(courseId);

    // Update user's course to use Document Reference
    await userRef.set({ courseRef }, { merge: true });

    // Add user to classroom
    const classroomQuery = db.collection("classrooms").where("courseRef", "==", courseRef);
    const classroomSnapshot = await classroomQuery.get();

    let classroomId;

    if (classroomSnapshot.empty) {
      // Create new classroom if not exists
      const newClassroom = await db.collection("classrooms").add({
        courseRef, // Store the course reference here
        members: [userRef], // Store user references instead of IDs
      });

      classroomId = newClassroom.id;

      // Update the newly created classroom with its ID
      await newClassroom.update({
        classroomId,
      });

      // Create duelQueueCollection for this classroom
      await db.collection("duelQueue").doc(classroomId).set({
        classroomRef: newClassroom,
        openDuels: [], // Initialize with an empty array
      });
    } else {
      // Add user to existing classroom
      const classroomDoc = classroomSnapshot.docs[0];
      classroomId = classroomDoc.id;
      await classroomDoc.ref.update({
        members: FieldValue.arrayUnion(userRef),
      });
    }

    res.status(200).json({
      classroomId, // Return only the document ID
      message: "User joined the course",
    });
  } catch (error) {
    console.error("Error in joinCourse:", error.message);
    res.status(500).json({ error: error.message });
  }
});





// Gebe den Classroom mit allen Membern aus
export const getClassroom = functions.https.onRequest(async (req, res) => {
  try {
    const { classroomId } = req.query;

    if (!classroomId) {
      res.status(400).json({ error: "classroomId is required" });
      return;
    }

    const classroomDoc = await db.collection("classrooms").doc(classroomId as string).get();

    if (!classroomDoc.exists) {
      res.status(404).json({ error: "Classroom not found." });
      return;
    }

    const classroomData = classroomDoc.data();

    // Hole die Course-Daten über die Reference
    const courseRef = classroomData?.courseRef;
    let courseData = null;
    if (courseRef) {
      const courseDoc = await courseRef.get();
      courseData = courseDoc.exists ? { id: courseDoc.id, ...courseDoc.data() } : null;
    }

    // Hole alle Mitglieder
    const memberRefs = classroomData?.members || [];
    const members = await Promise.all(
      memberRefs.map(async (memberRef: FirebaseFirestore.DocumentReference) => {
        const userDoc = await memberRef.get();
        return userDoc.exists ? { id: userDoc.id, ...userDoc.data() } : null;
      })
    );

    res.status(200).json({
      id: classroomDoc.id,
      course: courseData,
      members: members.filter((member) => member !== null), // Filtere ungültige Mitglieder
    });
  } catch (error) {
    res.status(500).json({ error: "Error fetching classroom: " + error.message });
  }
});



export const createQuestionSet = functions.https.onRequest(async (req, res) => {
  try {
    const { questionText, answers, correctAnswerText } = req.body;

    if (!questionText || !Array.isArray(answers) || answers.length !== 4 || !correctAnswerText) {
      res.status(400).json({
        error: "Invalid input. Provide 'questionText', an array of 4 'answers', and a 'correctAnswerText'.",
      });
      return;
    }

    // Frage erstellen
    const questionRef = await db.collection("questions").add({
      questionText,
      correctAnswerId: "", // Platzhalter, wird nach Erstellung der Antworten gesetzt
      answers: [], // Platzhalter für die Referenzen auf die Antworten
    });

    // Antworten hinzufügen und Referenzen speichern
    const answerRefs: FirebaseFirestore.DocumentReference[] = [];
    let correctAnswerId = "";
    for (const answerText of answers) {
      const answerRef = await db.collection("answers").add({
        text: answerText,
        questionRef, // Referenz zur Frage
      });
      answerRefs.push(answerRef);

      if (answerText === correctAnswerText) {
        correctAnswerId = answerRef.id;
      }
    }

    // Frage aktualisieren mit Referenzen auf die Antworten und korrekter Antwort-ID
    await questionRef.update({
      correctAnswerId,
      answers: answerRefs, // Speichern der Antwortreferenzen
    });

    res.status(201).json({
      message: "Question set created successfully.",
      questionId: questionRef.id,
    });
  } catch (error) {
    console.error("Error in createQuestionSet:", error.message);
    res.status(500).json({ error: "Error creating question set: " + error.message });
  }
});



  export const joinDuel = functions.https.onRequest(async (req, res) => {
    try {
      const { userId, classroomId } = req.body;

      if (!userId || !classroomId) {
        res.status(400).json({ error: "userId and classroomId are required" });
        return;
      }

      const userRef = db.collection("users").doc(userId);
      const classroomRef = db.collection("classrooms").doc(classroomId);

      const queueRef = db.collection("duelQueue").doc(classroomId);
      const queueDoc = await queueRef.get();

      // Spieler zur Warteschlange hinzufügen, wenn sie leer ist
      if (!queueDoc.exists || !queueDoc.data()?.openDuels?.length) {
        await queueRef.set(
          {
            classroomRef,
            openDuels: FieldValue.arrayUnion(userRef),
          },
          { merge: true }
        );
        res.status(200).json({
          message: "You have been added to the queue.",
        });
        return;
      }

      const openDuels: FirebaseFirestore.DocumentReference[] = queueDoc.data()?.openDuels || [];
      const opponentRef = openDuels[0];
      await queueRef.update({
        openDuels: FieldValue.arrayRemove(opponentRef),
      });

      // Neues Duell erstellen
      const duelRef = await db.collection("duels").add({
        classroomRef,
        player1: opponentRef,
        player2: userRef,
        status: "active",
        currentRound: 1,
        currentTurn: opponentRef,
        scorePlayer1: 0,
        scorePlayer2: 0,
      });

      // Generiere geteilte Fragen für die Runden
      const generateSharedQuestions = async (questionIds: string[]): Promise<PlayerAnswer[]> => {
        const questions: PlayerAnswer[] = [];

        for (const questionId of questionIds) {
          const questionRef = db.collection("questions").doc(questionId);

          // Hole die Antworten aus der "answers"-Collection
          const answersSnapshot = await db.collection("answers").where("questionRef", "==", questionRef).get();

          answersSnapshot.docs.forEach((answerDoc) => {
            questions.push({
              ref: answerDoc.ref as FirebaseFirestore.DocumentReference<AnswerData>, // Typisierung sicherstellen
              status: "unanswered",
            });
          });
        }

        return questions;
      };

      // Hole 15 zufällige Fragen (für 5 Runden, 3 Fragen pro Runde)
      const questionsSnapshot = await db.collection("questions").orderBy("createdAt").limit(15).get();
      const questionIds = questionsSnapshot.docs.map((doc) => doc.id);

      // Erstelle Runden als separate Dokumente
      const roundRefs = [];
      for (let i = 1; i <= 5; i++) {
        const sharedQuestions = await generateSharedQuestions(questionIds.slice((i - 1) * 3, i * 3));

        const roundRef = await db.collection("rounds").add({
          duelRef,
          roundNumber: i,
          player1Answers: sharedQuestions,
          player2Answers: sharedQuestions,
        });
        roundRefs.push(roundRef);
      }

      // Rundenreferenzen im Duell speichern
      await duelRef.update({
        rounds: roundRefs.map((ref) => ref.id),
      });

      // Spieler benachrichtigen
      await sendNotification(opponentRef, "Du bist dran!", "Das Duell wurde gestartet. Beantworte deine erste Frage.", {
        duelId: duelRef.id,
      });
      await sendNotification(userRef, "Warten auf Spieler 1", "Das Duell wurde gestartet. Dein Gegner beginnt.", {
        duelId: duelRef.id,
      });

      res.status(200).json({
        message: "Duel created successfully",
        duelId: duelRef.id,
      });
    } catch (error) {
      console.error("Error in joinDuel:", error.message);
      res.status(500).json({ error: "Error joining duel: " + error.message });
    }
  });


/**
 * Generiert eine Liste von Fragen, die in einer Runde geteilt werden.
 */





async function sendNotification(
  userRef: FirebaseFirestore.DocumentReference, // Erwartet DocumentReference
  title: string,
  body: string,
  data?: Record<string, any>
) {
  try {
    // Benutzer-Dokument abrufen
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      console.log(`User document ${userRef.id} not found.`);
      return;
    }

    const userData = userDoc.data();
    const fcmToken = userData?.fcmToken;

    // Überprüfen, ob FCM-Token vorhanden ist
    if (!fcmToken) {
      console.log(`User ${userRef.id} has no FCM token.`);
      return;
    }

    // Nachricht erstellen
    const message = {
      token: fcmToken,
      notification: { title, body },
      data: data || {},
    };

    // Nachricht senden
    await admin.messaging().send(message);
    console.log(`Notification sent to user ${userRef.id}: ${title}`);
  } catch (error) {
    console.error(`Error sending notification to user ${userRef.id}:`, error.message);
    throw new Error("Notification sending failed: " + error.message);
  }
}



export const answerQuestion = functions.https.onRequest(async (req, res) => {
  try {
    const { roundId, questionRef, userRef, answerId } = req.body;

    if (!roundId || !questionRef || !userRef || !answerId) {
      res.status(400).json({ error: "Missing required fields." });
      return;
    }

    // Runden-Dokument abrufen
    const roundRef = db.collection("rounds").doc(roundId);
    const roundDoc = await roundRef.get();

    if (!roundDoc.exists) {
      res.status(404).json({ error: "Round not found." });
      return;
    }

    const roundData = roundDoc.data() as RoundData;

    // Zugehöriges Duell-Dokument abrufen
    const duelRef = roundData.duelRef;
    const duelDoc = await duelRef.get();

    if (!duelDoc.exists) {
      res.status(404).json({ error: "Duel not found." });
      return;
    }

    const duelData = duelDoc.data() as DuelData;

    // Überprüfen, ob der Benutzer Spieler 1 ist
    const isPlayer1 = userRef.isEqual(duelData.player1);
    const answersKey = isPlayer1 ? "player1Answers" : "player2Answers";
    const opponentKey = isPlayer1 ? "player2Answers" : "player1Answers";

    const answers = roundData[answersKey];
    const opponentAnswers = roundData[opponentKey];

    // Frage-Dokument abrufen
    const questionDoc = await questionRef.get();
    const questionData = questionDoc.data() as QuestionData;

    if (!questionData) {
      res.status(500).json({ error: "Invalid question data." });
      return;
    }

    // Richtige Antwort abrufen
    const correctAnswerDoc = await db
      .collection("answers")
      .doc(questionData.correctAnswerId)
      .get();

    if (!correctAnswerDoc.exists) {
      res.status(500).json({ error: "Correct answer not found." });
      return;
    }

    const correctAnswer = correctAnswerDoc.data() as AnswerData;
    const isCorrect = correctAnswerDoc.id === answerId;

    // Antwort aktualisieren
    const updatedAnswers = answers.map((answer: PlayerAnswer) =>
      answer.ref.isEqual(questionRef)
        ? { ...answer, status: isCorrect ? "correct" : "incorrect" }
        : answer
    );

    roundData[answersKey] = updatedAnswers;

    // Feedback an den Spieler
    const feedbackMessage = isCorrect
      ? "Richtig beantwortet! Gut gemacht."
      : `Falsch beantwortet. Die richtige Antwort ist: "${correctAnswer.text}"`;

    await sendNotification(userRef, isCorrect ? "Richtig!" : "Falsch!", feedbackMessage, {
      roundId,
      questionId: questionRef.id,
    });

    // Prüfen, ob alle Fragen der aktuellen Spieler beantwortet wurden
    const allAnsweredByPlayer = updatedAnswers.every(
      (answer: PlayerAnswer) => answer.status !== "unanswered"
    );

    if (allAnsweredByPlayer) {
      // Wenn beide Spieler ihre Fragen beantwortet haben, werten wir die Runde aus
      const allOpponentAnswered = opponentAnswers.every(
        (answer: PlayerAnswer) => answer.status !== "unanswered"
      );

      if (allOpponentAnswered) {
        // Punkte der Runde berechnen
        const player1Correct = roundData.player1Answers.filter((a) => a.status === "correct").length;
        const player2Correct = roundData.player2Answers.filter((a) => a.status === "correct").length;

        if (player1Correct > player2Correct) {
          duelData.scorePlayer1++;
        } else if (player2Correct > player1Correct) {
          duelData.scorePlayer2++;
        } else {
          // Unentschieden
          duelData.scorePlayer1++;
          duelData.scorePlayer2++;
        }

        // Runde abgeschlossen -> Update im Duell
        const isLastRound = roundData.roundNumber === 5;

        if (isLastRound) {
          duelData.status = "finished";

          // Gewinner ermitteln
          const player1Score = duelData.scorePlayer1;
          const player2Score = duelData.scorePlayer2;

          let winnerMessage = "";
          let loserMessage = "";
          if (player1Score > player2Score) {
            winnerMessage = `Herzlichen Glückwunsch! Du hast das Duell gewonnen. Endstand: ${player1Score}:${player2Score}`;
            loserMessage = `Schade, du hast das Duell verloren. Endstand: ${player2Score}:${player1Score}`;
            await sendNotification(duelData.player1, "Du hast gewonnen!", winnerMessage, {
              duelId: duelRef.id,
            });
            await sendNotification(duelData.player2, "Du hast verloren!", loserMessage, {
              duelId: duelRef.id,
            });
          } else if (player2Score > player1Score) {
            winnerMessage = `Herzlichen Glückwunsch! Du hast das Duell gewonnen. Endstand: ${player2Score}:${player1Score}`;
            loserMessage = `Schade, du hast das Duell verloren. Endstand: ${player1Score}:${player2Score}`;
            await sendNotification(duelData.player2, "Du hast gewonnen!", winnerMessage, {
              duelId: duelRef.id,
            });
            await sendNotification(duelData.player1, "Du hast verloren!", loserMessage, {
              duelId: duelRef.id,
            });
          } else {
            const drawMessage = `Unentschieden! Endstand: ${player1Score}:${player2Score}`;
            await sendNotification(duelData.player1, "Unentschieden!", drawMessage, {
              duelId: duelRef.id,
            });
            await sendNotification(duelData.player2, "Unentschieden!", drawMessage, {
              duelId: duelRef.id,
            });
          }
        } else {
          duelData.currentRound++;
          duelData.currentTurn =
            duelData.currentRound % 2 === 0 ? duelData.player2 : duelData.player1;

          await sendNotification(
            duelData.player1,
            "Runde abgeschlossen!",
            "Die nächste Runde beginnt.",
            { duelId: duelRef.id }
          );
          await sendNotification(
            duelData.player2,
            "Runde abgeschlossen!",
            "Die nächste Runde beginnt.",
            { duelId: duelRef.id }
          );
        }
      }
    }

    // Updates speichern
    await roundRef.update({ [answersKey]: updatedAnswers });
    await duelRef.update({
      scorePlayer1: duelData.scorePlayer1,
      scorePlayer2: duelData.scorePlayer2,
      currentRound: duelData.currentRound,
      currentTurn: duelData.currentTurn,
      status: duelData.status,
    });

    res.status(200).json({ message: "Answer processed successfully.", isCorrect });
  } catch (error) {
    console.error("Error in answerQuestion:", error.message);
    res.status(500).json({ error: "Error processing answer: " + error.message });
  }
});



// Typen
interface AnswerData {
  text: string; // Text der Antwort
  questionRef: FirebaseFirestore.DocumentReference; // Referenz zur zugehörigen Frage
}

interface QuestionData {
  questionText: string; // Die Frage
  correctAnswerId: string; // ID der korrekten Antwort
  answers: FirebaseFirestore.DocumentReference[]; // Array mit Referenzen auf die Antwortdokumente
}

interface PlayerAnswer {
  ref: FirebaseFirestore.DocumentReference<AnswerData>; // Referenz zur Antwort
  status: string; // "unanswered", "correct", "incorrect"
}

interface RoundData {
  duelRef: FirebaseFirestore.DocumentReference; // Referenz zum Duell
  roundNumber: number; // Nummer der Runde
  player1Answers: PlayerAnswer[]; // Antworten von Spieler 1
  player2Answers: PlayerAnswer[]; // Antworten von Spieler 2
}

interface DuelData {
  player1: FirebaseFirestore.DocumentReference; // Spieler 1
  player2: FirebaseFirestore.DocumentReference; // Spieler 2
  currentTurn: FirebaseFirestore.DocumentReference; // Wer ist dran?
  currentRound: number; // Aktuelle Runde
  scorePlayer1: number; // Punkte von Spieler 1
  scorePlayer2: number; // Punkte von Spieler 2
  status: string; // Status des Duells ("active", "finished")
  classroomRef: FirebaseFirestore.DocumentReference; // Referenz zum Klassenraum
  rounds: string[]; // Array von Runden-IDs
}
