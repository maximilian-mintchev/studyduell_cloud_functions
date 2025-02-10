

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore"; // Import Firestore-spezifischer Methoden
import * as cors from "cors";



admin.initializeApp();

const db = admin.firestore();
const corsHandler = cors({ origin: true });


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
  corsHandler(req, res, async () => {

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
      // Create new classroom if it doesn't exist
      const newClassroom = await db.collection("classrooms").add({
        courseRef, // Store the course reference here
        members: [userRef], // Store user references instead of IDs
        waitingPlayer: null, // Initialize waitingPlayer as null
      });

      classroomId = newClassroom.id;

      // Update the newly created classroom with its ID
      await newClassroom.update({
        classroomId,
      });
    } else {
      // Add user to existing classroom
      const classroomDoc = classroomSnapshot.docs[0];
      classroomId = classroomDoc.id;

      // Update members array with the new user
      await classroomDoc.ref.update({
        members: FieldValue.arrayUnion(userRef),
      });
    }
    res.set('Access-Control-Allow-Origin', '*');

    res.status(200).json({
      classroomId, // Return only the document ID
      message: "User joined the course",
    });
  } catch (error) {
    console.error("Error in joinCourse:", error.message);
    res.status(500).json({ error: error.message });
  }
});
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
    const { questionText, answers, correctAnswerIndex } = req.body;

    // Eingabe validieren
    if (
      !questionText ||
      !Array.isArray(answers) ||
      answers.length !== 4 ||
      correctAnswerIndex === undefined ||
      correctAnswerIndex < 0 ||
      correctAnswerIndex > 3
    ) {
      res.status(400).json({
        error:
          "Invalid input. Provide 'questionText', an array of 4 'answers', and a valid 'correctAnswerIndex' (0-3).",
      });
      return;
    }

    // IDs für die Antworten (1, 2, 3, 4)
    const formattedAnswers = answers.map((answerText, index) => ({
      id: (index + 1).toString(), // IDs: "1", "2", "3", "4"
      text: answerText,
    }));

    // ID der korrekten Antwort basierend auf dem Index
    const correctAnswerId = (correctAnswerIndex + 1).toString();

    // Frage mit Antworten speichern
    const questionData = {
      questionText,
      correctAnswerId, // Speichern der ID der korrekten Antwort
      answers: formattedAnswers, // Antworten direkt als Array von Objekten speichern
    };

    const questionRef = await db.collection("questions").add(questionData);

    res.status(201).json({
      message: "Question set created successfully.",
      questionId: questionRef.id,
    });
  } catch (error) {
    console.error("Error in createQuestionSet:", error.message);
    res.status(500).json({ error: "Error creating question set: " + error.message });
  }
});

export const createExampleQuestionSets = functions.https.onRequest(async (req, res) => {
  try {
    // Beispiel-Fragesets
    const exampleQuestions = [
      {
        questionText: "What is the capital of France?",
        answers: ["Berlin", "Madrid", "Paris", "Rome"],
        correctAnswerIndex: 2,
      },
      {
        questionText: "What is 2 + 2?",
        answers: ["3", "4", "5", "6"],
        correctAnswerIndex: 1,
      },
      {
        questionText: "Who wrote 'To Kill a Mockingbird'?",
        answers: ["Harper Lee", "J.K. Rowling", "Ernest Hemingway", "Mark Twain"],
        correctAnswerIndex: 0,
      },
      {
        questionText: "What is the chemical symbol for water?",
        answers: ["H2O", "O2", "CO2", "NaCl"],
        correctAnswerIndex: 0,
      },
      {
        questionText: "Which planet is known as the Red Planet?",
        answers: ["Venus", "Mars", "Jupiter", "Saturn"],
        correctAnswerIndex: 1,
      },
      {
        questionText: "Who painted the Mona Lisa?",
        answers: ["Vincent van Gogh", "Leonardo da Vinci", "Pablo Picasso", "Claude Monet"],
        correctAnswerIndex: 1,
      },
      {
        questionText: "What is the tallest mountain in the world?",
        answers: ["K2", "Mount Everest", "Kangchenjunga", "Lhotse"],
        correctAnswerIndex: 1,
      },
      {
        questionText: "What is the largest ocean on Earth?",
        answers: ["Atlantic Ocean", "Indian Ocean", "Arctic Ocean", "Pacific Ocean"],
        correctAnswerIndex: 3,
      },
      {
        questionText: "What is the freezing point of water?",
        answers: ["0°C", "32°F", "100°C", "212°F"],
        correctAnswerIndex: 0,
      },
      {
        questionText: "Who developed the theory of relativity?",
        answers: ["Isaac Newton", "Albert Einstein", "Nikola Tesla", "Galileo Galilei"],
        correctAnswerIndex: 1,
      },
      {
        questionText: "What is the square root of 64?",
        answers: ["6", "7", "8", "9"],
        correctAnswerIndex: 2,
      },
      {
        questionText: "Which country is famous for the Great Wall?",
        answers: ["Japan", "India", "China", "Korea"],
        correctAnswerIndex: 2,
      },
      {
        questionText: "What is the currency of Japan?",
        answers: ["Yen", "Won", "Dollar", "Euro"],
        correctAnswerIndex: 0,
      },
      {
        questionText: "Which animal is known as the King of the Jungle?",
        answers: ["Tiger", "Lion", "Elephant", "Leopard"],
        correctAnswerIndex: 1,
      },
      {
        questionText: "What is the main ingredient in guacamole?",
        answers: ["Tomato", "Avocado", "Onion", "Pepper"],
        correctAnswerIndex: 1,
      },
    ];

    // Batch-Erstellung von Fragen
    const batch = db.batch();
    const questionCollection = db.collection("questions");

    exampleQuestions.forEach((question) => {
      const questionRef = questionCollection.doc();
      const formattedAnswers = question.answers.map((answerText, index) => ({
        id: (index + 1).toString(),
        text: answerText,
      }));

      const questionData = {
        questionText: question.questionText,
        correctAnswerId: (question.correctAnswerIndex + 1).toString(),
        answers: formattedAnswers,
      };

      batch.set(questionRef, questionData);
    });

    // Batch speichern
    await batch.commit();

    res.status(201).json({
      message: "15 example questions created successfully.",
    });
  } catch (error) {
    console.error("Error creating example questions:", error.message);
    res.status(500).json({ error: "Error creating example questions: " + error.message });
  }
});

export const createCorporateCommunicationQuestions = functions.https.onRequest(async (req, res) => {
  try {
    // JSON-Fragesatz
    const exampleQuestions = [
      {
        question: "What is the primary goal of Corporate Communication?",
        options: ["Maximizing profits", "Ensuring effective information exchange", "Controlling stakeholder actions", "Increasing product sales"],
        answer: "Ensuring effective information exchange",
        level: "Remember",
      },
      {
        question: "Which governance type includes the regulation of Social Media activities?",
        options: ["IT Governance", "Corporate Governance", "Social Media Governance", "Stakeholder Governance"],
        answer: "Social Media Governance",
        level: "Remember",
      },
      {
        question: "What is the term for transforming raw data into meaningful information?",
        options: ["Encoding", "Data Processing", "Decoding", "Communication Modeling"],
        answer: "Data Processing",
        level: "Remember",
      },
      {
        question: "Which framework is used to analyze stakeholders' power and legitimacy?",
        options: ["SWOT Analysis", "Mitchell et al.'s Stakeholder Mapping", "PESTEL Framework", "Porter's Five Forces"],
        answer: "Mitchell et al.'s Stakeholder Mapping",
        level: "Remember",
      },
      {
        question: "What does 'XML' stand for?",
        options: ["Extended Markup Language", "Extensible Markup Language", "External Metadata Language", "Exclusive Metadata Language"],
        answer: "Extensible Markup Language",
        level: "Remember",
      },
      {
        question: "How does Social Media Governance help organizations?",
        options: ["By limiting employee activities", "By fostering organizational transparency", "By creating competitive advantages through coordinated activities", "By enforcing strict guidelines on all stakeholders"],
        answer: "By creating competitive advantages through coordinated activities",
        level: "Understand",
      },
      {
        question: "What distinguishes 'Information' from 'Data'?",
        options: ["Syntax", "Context and meaning", "Volume", "Processing speed"],
        answer: "Context and meaning",
        level: "Understand",
      },
      {
        question: "Why are Social Media guidelines crucial for organizations?",
        options: ["To limit creativity among employees", "To ensure legal compliance and reputation management", "To reduce the usage of social media platforms", "To increase individual social media usage"],
        answer: "To ensure legal compliance and reputation management",
        level: "Understand",
      },
      {
        question: "Which type of noise can arise from mismatched codes in communication?",
        options: ["Physical noise", "Semantic noise", "Syntactic noise", "Pragmatic noise"],
        answer: "Semantic noise",
        level: "Understand",
      },
      {
        question: "How does the 'Four-Sides Model' describe communication?",
        options: ["As a one-dimensional process", "As a system of encoding and decoding", "As a message with multiple layers, including fact, appeal, and self-revelation", "As a strictly linear exchange of information"],
        answer: "As a message with multiple layers, including fact, appeal, and self-revelation",
        level: "Understand",
      },
      {
        question: "A team uses Microsoft Teams and SharePoint to streamline internal communication. Which communication theory is most relevant?",
        options: ["Data-Information-Knowledge Cycle", "Push and Pull Communication Theory", "Model-Based Communication", "Social Media Governance"],
        answer: "Push and Pull Communication Theory",
        level: "Apply",
      },
      {
        question: "If a stakeholder group is both powerful and legitimate, which stakeholder classification applies (Mitchell et al.)?",
        options: ["Dormant", "Dominant", "Dangerous", "Definitive"],
        answer: "Definitive",
        level: "Apply",
      },
      {
        question: "How can XML enhance data exchange in corporate communication?",
        options: ["By reducing data duplication", "By simplifying document visualization", "By enabling structured and machine-readable formats", "By enforcing stricter security protocols"],
        answer: "By enabling structured and machine-readable formats",
        level: "Apply",
      },
      {
        question: "A company faces criticism on Twitter after launching a hashtag campaign. What is the best immediate response?",
        options: ["Ignore the criticism and move on", "Take down the campaign and issue a statement addressing the concerns", "Engage in heated debates with users", "Launch another campaign to divert attention"],
        answer: "Take down the campaign and issue a statement addressing the concerns",
        level: "Apply",
      },
      {
        question: "During a stakeholder communication meeting, employees demand clarification about their roles. Which stage of group process dynamics (Drexler et al.) are they likely in?",
        options: ["Orientation", "Target & Role Clarification", "Implementation", "Peak Performance"],
        answer: "Target & Role Clarification",
        level: "Apply",
      },
      {
        question: "Which type of stakeholders include employees, managers, and shareholders?",
        options: ["Internal stakeholders", "External stakeholders", "Primary stakeholders", "Tertiary stakeholders"],
        answer: "Internal stakeholders",
        level: "Remember",
      },
      {
        question: "What is the purpose of a Social Media Guideline?",
        options: ["To foster creativity in employees", "To prevent legal and reputational risks", "To increase social media usage", "To promote employee autonomy"],
        answer: "To prevent legal and reputational risks",
        level: "Understand",
      },
      {
        question: "Which communication medium is best suited for building commitment in internal communication?",
        options: ["Newsletters", "Team problem solving sessions", "Electronic mail", "Roadshows"],
        answer: "Team problem solving sessions",
        level: "Apply",
      },
      {
        question: "What is the primary goal of stakeholder communication according to Steyn (2003)?",
        options: ["To manage stakeholder resistance", "To build competitive advantage through collaboration", "To provide detailed company reports", "To enforce strict organizational policies"],
        answer: "To build competitive advantage through collaboration",
        level: "Understand",
      },
      {
        question: "How does the integration of platforms like SharePoint and Teams improve internal communication?",
        options: ["By simplifying workflows and reducing costs", "By enabling seamless content and communication integration", "By limiting employee autonomy", "By enforcing stricter communication policies"],
        answer: "By enabling seamless content and communication integration",
        level: "Apply",
      },
      {
        question: "Which dimension of communication focuses on balancing the expectations and power of stakeholders?",
        options: ["Semantic communication", "Strategic communication", "Stakeholder communication", "Operational communication"],
        answer: "Stakeholder communication",
        level: "Understand",
      },
    ];

    // Batch-Erstellung
    const batch = db.batch();
    const questionCollection = db.collection("questions");

    exampleQuestions.forEach((question) => {
      const questionRef = questionCollection.doc();
      const formattedAnswers = question.options.map((text, index) => ({
        id: (index + 1).toString(),
        text,
      }));

      const correctAnswerIndex = question.options.indexOf(question.answer);

      if (correctAnswerIndex === -1) {
        console.error(`Error: Answer not found in options for question: "${question.question}"`);
        return;
      }

      const questionData = {
        questionText: question.question,
        answers: formattedAnswers,
        correctAnswerId: (correctAnswerIndex + 1).toString(),
        level: question.level,
      };

      batch.set(questionRef, questionData);
    });

    await batch.commit();

    res.status(201).json({
      message: `${exampleQuestions.length} Corporate Communication questions created successfully.`,
    });
  } catch (error) {
    console.error("Error creating Corporate Communication questions:", error.message);
    res.status(500).json({ error: "Error creating Corporate Communication questions: " + error.message });
  }
});







export const joinDuel = functions.https.onRequest(async (req, res) => {
  
  corsHandler(req, res, async () => {

    try {
      const { userId, classroomId } = req.body;

      if (!userId || !classroomId) {
        res.status(400).json({ error: "userId and classroomId are required" });
        return;
      }

      const userRef = db.collection("users").doc(userId);
      const classroomRef = db.collection("classrooms").doc(classroomId);

      // Transaktion verwenden, um Race-Conditions zu verhindern
      const result = await db.runTransaction(async (transaction) => {
        const classroomDoc = await transaction.get(classroomRef);

        if (!classroomDoc.exists) {
          throw new Error("Classroom not found.");
        }
        

        const classroomData = classroomDoc.data();

        if (!classroomData?.waitingPlayer) {
          // Kein wartender Spieler -> Spieler zur Warteschlange hinzufügen
          transaction.update(classroomRef, {
            waitingPlayer: userRef,
          });
          return { status: "waiting", message: "You have been added to the queue." };
        }

        // Ein Spieler wartet -> Match mit dem wartenden Spieler
        const opponentRef = classroomData.waitingPlayer;

        // Wartenden Spieler entfernen
        transaction.update(classroomRef, {
          waitingPlayer: FieldValue.delete(),
        });

        return { status: "matched", opponentRef };
      });

      if (result.status === "waiting") {
        res.status(200).json({
          message: result.message,
          duelId: null, // Kein Duell erstellt
        });
        return;
      }

      const opponentRef = result.opponentRef;

      // Funktion zum Generieren von Runden
      const generateRounds = async (): Promise<any[]> => {
        const questionsSnapshot = await db.collection("questions").limit(15).get();
        const questions = questionsSnapshot.docs.map((doc) => ({
          questionId: doc.id,
          questionText: doc.data().questionText,
          answers: doc.data().answers, // Antworten direkt in der Frage enthalten
          correctAnswerId: doc.data().correctAnswerId, // ID der richtigen Antwort
          currentAnswerId: null, // Zu Beginn keine Antwort ausgewählt
        }));

        const rounds: any[] = [];
        for (let i = 0; i < 5; i++) {
          const roundQuestions = questions.slice(i * 3, i * 3 + 3);
          rounds.push({
            roundNumber: i,
            currentQuestionIndex: 0, // Start bei der ersten Frage
            player1Answers: roundQuestions.map((q) => ({ ...q, status: "unanswered" })),
            player2Answers: roundQuestions.map((q) => ({ ...q, status: "unanswered" })),
          });
        }

        return rounds;
      };

      // Runden generieren
      const rounds = await generateRounds();

      // Neues Duell erstellen
      const duelRef = db.collection("duels").doc();
      const duelData: DuelData = {
        classroomRef,
        player1: opponentRef,
        player2: userRef,
        status: "active",
        currentRound: 0, // Start bei der ersten Runde
        currentTurn: opponentRef, // Der wartende Spieler beginnt
        scorePlayer1: 0,
        scorePlayer2: 0,
        duelId: duelRef.id,
        rounds,
      };

      await duelRef.set(duelData);

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
  corsHandler(req, res, async () => {

    try {
      const { duelId, userId, answerId } = req.body;

      if (!duelId || !userId || !answerId) {
        res.status(400).json({ error: "Missing required fields." });
        return;
      }

      console.log(`Received request: duelId=${duelId}, userId=${userId}, answerId=${answerId}`);

      // Duell-Dokument abrufen
      const duelRef = db.collection("duels").doc(duelId);
      const duelDoc = await duelRef.get();

      if (!duelDoc.exists) {
        res.status(404).json({ error: "Duel not found." });
        return;
      }

      const duelData = duelDoc.data() as DuelData;
      const { currentRound, currentTurn, rounds, player1, player2, status } = duelData;

      console.log(`Current turn: ${currentTurn.id}, Current round: ${currentRound}`);

      // Überprüfen, ob das Duell bereits beendet ist
      if (status === "finished") {
        res.status(400).json({ error: "The duel has already ended." });
        console.log("The duel is already finished.");
        return;
      }

      // Überprüfen, ob der Benutzer an diesem Duell beteiligt ist
      const isPlayer1 = player1.id === userId;
      const isPlayer2 = player2.id === userId;

      if (!isPlayer1 && !isPlayer2) {
        res.status(403).json({ error: "User is not part of this duel." });
        return;
      }

      console.log(`User is ${isPlayer1 ? "Player 1" : "Player 2"}`);

      // Überprüfen, ob der Benutzer am Zug ist
      if (currentTurn.id !== userId) {
        res.status(403).json({ error: "It's not your turn." });
        return;
      }

      // Aktuelle Runde und Frage ermitteln
      const round = rounds[currentRound];
      if (!round) {
        res.status(500).json({ error: "Invalid current round." });
        return;
      }

      const { currentQuestionIndex, player1Answers, player2Answers } = round;

      if (currentQuestionIndex === null || currentQuestionIndex < 0) {
        res.status(500).json({ error: "Invalid current question index." });
        return;
      }

      console.log(`Current question index: ${currentQuestionIndex}`);

      // Antworten-Array basierend auf dem Spieler ermitteln
      const answersArray = isPlayer1 ? player1Answers : player2Answers;

      if (!answersArray || currentQuestionIndex >= answersArray.length) {
        res.status(500).json({ error: "Invalid answers array or index out of bounds." });
        return;
      }

      const question = answersArray[currentQuestionIndex];
      if (!question) {
        res.status(500).json({ error: "Invalid question data." });
        return;
      }

      console.log("Current question fetched successfully:", question);

      // Überprüfen, ob die Antwort korrekt ist
      const isCorrect = question.correctAnswerId === answerId;
      console.log(`Answer is ${isCorrect ? "correct" : "incorrect"}`);

      // Spielerantwort aktualisieren
      answersArray[currentQuestionIndex] = {
        ...question,
        currentAnswerId: answerId,
        status: isCorrect ? "correct" : "incorrect",
      };

      // Punkte aktualisieren, falls die Antwort korrekt war
      if (isCorrect) {
        if (isPlayer1) {
          duelData.scorePlayer1 += 1;
        } else {
          duelData.scorePlayer2 += 1;
        }
      }

      console.log("Scores updated:", {
        scorePlayer1: duelData.scorePlayer1,
        scorePlayer2: duelData.scorePlayer2,
      });

      // Prüfen, ob der Spieler alle Fragen der Runde beantwortet hat
      const playerFinishedAllQuestions = answersArray.every(
        (answer) => answer.status && answer.status !== "unanswered"
      );

      if (playerFinishedAllQuestions) {
        console.log(`Player ${isPlayer1 ? "1" : "2"} has finished all questions.`);

        if (isPlayer2) {
          console.log("Player 2 finished the round.");

          // Runde ist abgeschlossen, zur nächsten Runde übergehen
          if (currentRound === rounds.length - 1) {
            duelData.status = "finished";

            console.log("Duel finished. Final scores:", {
              scorePlayer1: duelData.scorePlayer1,
              scorePlayer2: duelData.scorePlayer2,
            });

            // Gewinner ermitteln
            if (duelData.scorePlayer1 > duelData.scorePlayer2) {
              await sendNotification(player1, "Du hast gewonnen!", "Herzlichen Glückwunsch!");
              await sendNotification(player2, "Du hast verloren!", "Besser beim nächsten Mal!");
            } else if (duelData.scorePlayer2 > duelData.scorePlayer1) {
              await sendNotification(player2, "Du hast gewonnen!", "Herzlichen Glückwunsch!");
              await sendNotification(player1, "Du hast verloren!", "Besser beim nächsten Mal!");
            } else {
              await sendNotification(player1, "Unentschieden!", "Das Duell endet unentschieden!");
              await sendNotification(player2, "Unentschieden!", "Das Duell endet unentschieden!");
            }
          } else {
            duelData.currentRound += 1;
            duelData.currentTurn = player1;
            rounds[currentRound].currentQuestionIndex = 0;
            console.log("Next round started. Current turn: Player 1");
          }
        } else {
          // Spieler 2 ist an der Reihe
          duelData.currentTurn = player2;
          rounds[currentRound].currentQuestionIndex = 0;
          console.log("Player 2's turn to complete the round.");
        }
      } else {
        // Zur nächsten Frage der Runde übergehen
        round.currentQuestionIndex += 1;
        console.log("Moved to the next question. New question index:", round.currentQuestionIndex);
      }

      // Duell-Dokument aktualisieren
      console.log("Updating duel document with new data.");
      await duelRef.update({
        rounds,
        currentRound: duelData.currentRound,
        currentTurn: duelData.currentTurn,
        status: duelData.status,
        scorePlayer1: duelData.scorePlayer1,
        scorePlayer2: duelData.scorePlayer2,
      });

      console.log("Duel document updated successfully.");
      res.status(200).json({
        message: isCorrect ? "Answer is correct!" : "Answer is incorrect.",
        isCorrect,
        correctAnswerId: question.correctAnswerId, // Füge die korrekte Antwort-ID hinzu
      });
    } catch (error) {
      console.error("Error in answerQuestion:", error.message, error.stack);
      res.status(500).json({ error: "Error processing answer: " + error.message });
    }
  });

});



export const getInitialDuelData = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      const { duelId } = req.body;

      if (!duelId) {
        res.status(400).json({ error: "Duel ID is required." });
        return;
      }

      console.log(`Received request: duelId=${duelId}`);

      // Duell-Dokument abrufen
      const duelRef = db.collection("duels").doc(duelId);
      const duelDoc = await duelRef.get();

      if (!duelDoc.exists) {
        res.status(404).json({ error: "Duel not found." });
        return;
      }

      const duelData = duelDoc.data();
      if (!duelData) {
        res.status(500).json({ error: "Invalid duel data." });
        return;
      }

      const { currentRound, rounds, currentTurn } = duelData;

      console.log(`Current round: ${currentRound}`);

      // Überprüfen, ob die Runden-Daten gültig sind
      if (!Array.isArray(rounds) || currentRound < 0 || currentRound >= rounds.length) {
        res.status(400).json({ error: "Invalid round data." });
        return;
      }

      const round = rounds[currentRound];

      if (!round || typeof round.currentQuestionIndex !== "number") {
        res.status(400).json({ error: "Invalid question data in the current round." });
        return;
      }

      const currentQuestionIndex = round.currentQuestionIndex;

      console.log(`Current question index: ${currentQuestionIndex}`);

      // Die Position der Frage ist 1-basiert
      const questionPosition = currentQuestionIndex;

      // Die currentTurnId extrahieren
      const currentTurnId = currentTurn ? currentTurn.id : null;

      res.status(200).json({
        questionPosition,
        currentRound,
        currentTurnId, // Füge die currentTurnId hinzu
        message: `Current question position is ${questionPosition}, current round is ${currentRound}, and current turn is ${currentTurnId}`,
      });
    } catch (error) {
      console.error("Error in getInitialDuelData:", error.message, error.stack);
      res.status(500).json({ error: "Error retrieving initial duel data: " + error.message });
    }
  });
});



// export const getInitialDuelData = functions.https.onRequest(async (req, res) => {
//   try {
//     const { duelId } = req.body;

//     if (!duelId) {
//       res.status(400).json({ error: "Duel ID is required." });
//       return;
//     }

//     console.log(`Received request: duelId=${duelId}`);

//     // Duell-Dokument abrufen
//     const duelRef = db.collection("duels").doc(duelId);
//     const duelDoc = await duelRef.get();

//     if (!duelDoc.exists) {
//       res.status(404).json({ error: "Duel not found." });
//       return;
//     }

//     const duelData = duelDoc.data();
//     if (!duelData) {
//       res.status(500).json({ error: "Invalid duel data." });
//       return;
//     }

//     const { currentRound, rounds } = duelData;

//     console.log(`Current round: ${currentRound}`);

//     // Überprüfen, ob die Runden-Daten gültig sind
//     if (!Array.isArray(rounds) || currentRound < 0 || currentRound >= rounds.length) {
//       res.status(400).json({ error: "Invalid round data." });
//       return;
//     }

//     const round = rounds[currentRound];

//     if (!round || typeof round.currentQuestionIndex !== "number") {
//       res.status(400).json({ error: "Invalid question data in the current round." });
//       return;
//     }

//     const currentQuestionIndex = round.currentQuestionIndex;

//     console.log(`Current question index: ${currentQuestionIndex}`);

//     // Die Position der Frage ist 1-basiert
//     const questionPosition = currentQuestionIndex;

//     res.status(200).json({
//       questionPosition,
//       currentRound,
//       message: `Current question position is ${questionPosition}, and current round is ${currentRound}`,
//     });
//   } catch (error) {
//     console.error("Error in getInitialDuelData:", error.message, error.stack);
//     res.status(500).json({ error: "Error retrieving initial duel data: " + error.message });
//   }
// });








interface PlayerAnswer {
  questionId: string; // ID der Frage
  questionText: string; // Fragetext
  answers: {
    id: string; // Antwort-ID
    text: string; // Antwort-Text
  }[]; // Antwortmöglichkeiten
  correctAnswerId: string; // ID der korrekten Antwort
  currentAnswerId: string | null; // Vom Spieler gegebene Antwort (null, falls nicht beantwortet)
  status: "unanswered" | "correct" | "incorrect"; // Status der Antwort
}

interface Round {
  roundNumber: number; // Nummer der Runde
  currentQuestionIndex: number; // Aktuelle Frage in der Runde
  player1Answers: PlayerAnswer[]; // Antworten des Spielers 1
  player2Answers: PlayerAnswer[]; // Antworten des Spielers 2
}

interface DuelData {
  classroomRef: FirebaseFirestore.DocumentReference; // Referenz zum Klassenzimmer
  player1: FirebaseFirestore.DocumentReference; // Referenz Spieler 1
  player2: FirebaseFirestore.DocumentReference; // Referenz Spieler 2
  currentTurn: FirebaseFirestore.DocumentReference; // Wer ist dran
  status: "active" | "finished"; // Status des Duells
  currentRound: number; // Aktuelle Runde
  scorePlayer1: number; // Punkte von Spieler 1
  scorePlayer2: number; // Punkte von Spieler 2
  rounds: Round[]; // Runden des Duells
  duelId: string
}
