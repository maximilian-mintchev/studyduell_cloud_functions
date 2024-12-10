

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

        const universities = universitiesSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        res.status(200).json(universities);
    } catch (error) {
        res.status(500).send("Error retrieving universities: " + error.message);
    }
});

// export const getUniversities = functions.https.onRequest((req, res) => {
//     corsHandler(req, res, async () => {
//         try {
//             const universitiesSnapshot = await db.collection("universities").get();

//             if (universitiesSnapshot.empty) {
//                 res.status(404).send("No universities found.");
//                 return;
//             }

//             const universities = universitiesSnapshot.docs.map(doc => ({
//                 id: doc.id,
//                 ...doc.data(),
//             }));

//             res.status(200).json(universities);
//         } catch (error) {
//             res.status(500).send("Error retrieving universities: " + error.message);
//         }
//     });
// });


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

//API: einen neuen Kurs erstellen
export const createCourse = functions.https.onRequest(async (req, res) => {
    try {
        const { universityId, name } = req.body;
        if (!universityId || !name) {
            res.status(400).json({ error: "universityId and name are required" });
            return; // nur, um die Funktion zu beenden, nicht `res` zurückgeben
        }

        const courseRef = await db.collection("courses").add({ universityId, name });

        res.status(201).json({ id: courseRef.id, message: "Course created" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Kurse zu einer Universität abrufen
export const getCourses = functions.https.onRequest(async (req, res) => {
    try {
        const { universityId } = req.query;

        if (!universityId) {
            res.status(400).json({ error: "universityId is required" });
            return;
        }

        const coursesSnapshot = await db.collection("courses")
            .where("universityId", "==", universityId)
            .get();

        if (coursesSnapshot.empty) {
            res.status(404).json({ error: "No courses found for the given universityId." });
            return;
        }

        const courses = coursesSnapshot.docs.map(doc => ({
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
            return; // Stelle sicher, dass die Funktion hier beendet wird
        }

        // Update user's course
        const userRef = db.collection("users").doc(userId);
        await userRef.set({ courseId }, { merge: true });

        // Add user to classroom
        const classroomRef = db.collection("classrooms").where("courseId", "==", courseId);
        const classroomSnapshot = await classroomRef.get();

        let classroomId;

        if (classroomSnapshot.empty) {
            // Create new classroom if not exists
            const newClassroom = await db.collection("classrooms").add({
                courseId,
                members: [userId],
            });
            classroomId = newClassroom.id;
        } else {
            // Add user to existing classroom
            const classroomDoc = classroomSnapshot.docs[0];
            classroomId = classroomDoc.id;
            await db.collection("classrooms").doc(classroomId).update({
                members: FieldValue.arrayUnion(userId),
            });
        }

        // Sende die Antwort und beende die Funktion
        res.status(200).json({ classroomId, message: "User joined the course" });
    } catch (error) {
        // Fehler abfangen und eine 500-Antwort senden
        res.status(500).json({ error: error.message });
    }
});

//Gebe den Classroom mit allen Membern aus
export const getClassroom = functions.https.onRequest(async (req, res) => {
    try {
        const { classroomId } = req.query;

        if (!classroomId) {
            res.status(400).json({ error: "classroomId is required" });
            return;
        }

        // Hole den Classroom aus der Datenbank
        const classroomDoc = await db.collection("classrooms").doc(classroomId as string).get();

        if (!classroomDoc.exists) {
            res.status(404).json({ error: "Classroom not found." });
            return;
        }

        const classroomData = classroomDoc.data();

        // Hole alle Mitglieder (User-Details)
        const memberIds = classroomData?.members || [];
        const memberDocs = await Promise.all(
            memberIds.map(async (memberId: string) => {
                const userDoc = await db.collection("users").doc(memberId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    return {
                        id: userDoc.id,
                        displayName: userData?.displayName || "Unknown"
                    };
                }
                return null; // Falls ein User-Dokument fehlt
            })
        );

        // Filtere ungültige/null User-Daten heraus
        const members = memberDocs.filter(member => member !== null);

        // Rückgabe des Classrooms mit gefilterten Member-Feldern
        res.status(200).json({
            id: classroomDoc.id,
            courseId: classroomData?.courseId || null,
            members // Nur die ID und displayName der User
        });
    } catch (error) {
        res.status(500).json({ error: "Error fetching classroom: " + error.message });
    }
});

export const createQuestionSet = functions.https.onRequest(async (req, res) => {
    try {
        // Validierung des Requests
        const { questionText, answers, correctAnswerId } = req.body;

        if (!questionText || !Array.isArray(answers) || answers.length !== 4 || !correctAnswerId) {
            res.status(400).json({
                error: "Invalid input. Provide 'questionText', an array of 4 'answers', and a 'correctAnswerId'."
            });
            return; // Beende die Funktion
        }

        // Überprüfen, ob die korrekte Antwort in den Antworten enthalten ist
        const isValidCorrectAnswer = answers.some(answer => answer.id === correctAnswerId);
        if (!isValidCorrectAnswer) {
            res.status(400).json({
                error: "The correctAnswerId must match one of the IDs in the answers array."
            });
            return; // Beende die Funktion
        }

        // Dokument erstellen
        const questionSet = {
            questionText,
            answers,
            correctAnswerId,
            createdAt: FieldValue.serverTimestamp()
        };

        const docRef = await db.collection("questions").add(questionSet);

        // Erfolgsantwort mit der generierten ID
        res.status(201).json({
            message: "Question set created successfully.",
            id: docRef.id
        });
    } catch (error) {
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

        const queueRef = db.collection("duelQueue").doc(classroomId);
        const queueDoc = await queueRef.get();

        if (!queueDoc.exists || !queueDoc.data()?.openDuels?.length) {
            // Spieler in Warteschlange hinzufügen
            await queueRef.set(
                {
                    openDuels: FieldValue.arrayUnion({
                        userId,
                        timestamp: new Date().toISOString()
                    })
                },
                { merge: true }
            );
            res.status(200).json({ message: "You have been added to the queue." });
            return;
        }

        // Gegner finden und Warteschlange aktualisieren
        const openDuels = queueDoc.data()?.openDuels || [];
        const opponent = openDuels[0];
        await queueRef.update({
            openDuels: FieldValue.arrayRemove(opponent)
        });

        // Generiere 5 Runden mit jeweils 3 Fragen für beide Spieler
        const rounds = [];
        for (let i = 1; i <= 5; i++) {
            const player1Questions = (await db.collection("questions").orderBy("createdAt").limit(3).get()).docs.map(doc => ({
                id: doc.id,
                status: "unanswered"
            }));

            const player2Questions = (await db.collection("questions").orderBy("createdAt").limit(3).get()).docs.map(doc => ({
                id: doc.id,
                status: "unanswered"
            }));

            rounds.push({
                roundNumber: i,
                player1Answers: player1Questions,
                player2Answers: player2Questions
            });
        }

        // Bestimme den Startspieler der ersten Runde
        const startPlayer = "player1";

        // Neues Duell erstellen
        const duelRef = await db.collection("duels").add({
            classroomId,
            player1: opponent.userId,
            player2: userId,
            status: "active",
            currentRound: 1,
            currentTurn: startPlayer,
            score: { [opponent.userId]: 0, [userId]: 0 },
            rounds,
            createdAt: FieldValue.serverTimestamp()
        });

        // Spieler benachrichtigen
        await sendNotification(opponent.userId, "Du bist dran!", "Das Duell wurde gestartet. Beantworte deine erste Frage.", {
            duelId: duelRef.id
        });
        await sendNotification(userId, "Warten auf Spieler 1", "Das Duell wurde gestartet. Dein Gegner beginnt.", {
            duelId: duelRef.id
        });

        res.status(200).json({
            message: "Duel created successfully",
            duelId: duelRef.id
        });
    } catch (error) {
        res.status(500).json({ error: "Error joining duel: " + error.message });
    }
});


async function sendNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, any>
) {
    try {
        // Hole den FCM-Token des Benutzers
        const userDoc = await admin.firestore().collection("users").doc(userId).get();
        const userData = userDoc.data();
        const fcmToken = userData?.fcmToken;

        if (!fcmToken) {
            console.log(`User ${userId} has no FCM token.`);
            return;
        }

        // Erstelle die Nachricht
        const message = {
            token: fcmToken,
            notification: {
                title: title,
                body: body
            },
            data: data || {}
        };

        // Nachricht senden
        await admin.messaging().send(message);
        console.log(`Notification sent to user ${userId}: ${title}`);
    } catch (error) {
        console.error(`Error sending notification to user ${userId}:`, error.message);
    }
}






export const answerQuestion = functions.https.onRequest(async (req, res) => {
    try {
        const { duelId, questionId, userId, answerId } = req.body;

        if (!duelId || !questionId || !userId || !answerId) {
            res.status(400).json({ error: "Missing required fields." });
            return;
        }

        const duelRef = db.collection("duels").doc(duelId);
        const duelDoc = await duelRef.get();

        if (!duelDoc.exists) {
            res.status(404).json({ error: "Duel not found." });
            return;
        }

        const duelData = duelDoc.data() as DuelData;
        const { player1, player2, currentTurn, rounds, currentRound, score } = duelData;

        const isPlayer1 = currentTurn === "player1";
        const round = rounds[currentRound - 1];

        const answersKey = isPlayer1 ? "player1Answers" : "player2Answers";
        const answers = round[answersKey];

        const questionDoc = await db.collection("questions").doc(questionId).get();
        const questionData = questionDoc.data() as QuestionData;

        if (!questionData || !questionData.answers) {
            res.status(500).json({ error: "Invalid question data. Please check the questionId." });
            return;
        }

        const correctAnswerId = questionData.correctAnswerId;
        const correctAnswerText = questionData.answers.find(answer => answer.id === correctAnswerId)?.text || "Unknown";
        const isCorrect = correctAnswerId === answerId;

        const updatedAnswers = answers.map(answer =>
            answer.id === questionId ? { ...answer, status: isCorrect ? "correct" : "incorrect" } : answer
        );

        round[answersKey] = updatedAnswers;

        const feedbackMessage = isCorrect
            ? "Richtig beantwortet! Gut gemacht."
            : `Falsch beantwortet. Die richtige Antwort ist: "${correctAnswerText}"`;

        await sendNotification(userId, isCorrect ? "Richtig!" : "Falsch!", feedbackMessage, {
            duelId,
            questionId,
            correctAnswer: isCorrect ? null : correctAnswerText
        });

        const allAnswered = updatedAnswers.every(answer => answer.status !== "unanswered");
        let updatedTurn: string | null = currentTurn;

        if (allAnswered) {
            const player1Correct = round.player1Answers.filter(a => a.status === "correct").length;
            const player2Correct = round.player2Answers.filter(a => a.status === "correct").length;

            let roundWinner: string | null = null;
            if (player1Correct > player2Correct) {
                score[player1]++;
                roundWinner = player1;
            } else if (player2Correct > player1Correct) {
                score[player2]++;
                roundWinner = player2;
            } else {
                score[player1]++;
                score[player2]++;
            }

            if (currentRound === 5) {
                duelData.status = "finished";
                updatedTurn = null;

                let winnerMessage = "";
                let loserMessage = "";
                if (score[player1] > score[player2]) {
                    winnerMessage = `Herzlichen Glückwunsch! Du hast das Duell gewonnen. Endstand: ${score[player1]}:${score[player2]}`;
                    loserMessage = `Schade, du hast das Duell verloren. Endstand: ${score[player2]}:${score[player1]}`;
                    await sendNotification(player1, "Du hast gewonnen!", winnerMessage, { duelId });
                    await sendNotification(player2, "Du hast verloren.", loserMessage, { duelId });
                } else if (score[player2] > score[player1]) {
                    winnerMessage = `Herzlichen Glückwunsch! Du hast das Duell gewonnen. Endstand: ${score[player2]}:${score[player1]}`;
                    loserMessage = `Schade, du hast das Duell verloren. Endstand: ${score[player1]}:${score[player2]}`;
                    await sendNotification(player2, "Du hast gewonnen!", winnerMessage, { duelId });
                    await sendNotification(player1, "Du hast verloren.", loserMessage, { duelId });
                } else {
                    const drawMessage = `Unentschieden! Endstand: ${score[player1]}:${score[player2]}`;
                    await sendNotification(player1, "Unentschieden!", drawMessage, { duelId });
                    await sendNotification(player2, "Unentschieden!", drawMessage, { duelId });
                }
            } else {
                duelData.currentRound++;
                updatedTurn = duelData.currentRound % 2 === 0 ? "player2" : "player1";

                const roundSummary = `Runde ${currentRound} beendet: ${
                    roundWinner
                        ? `Spieler ${roundWinner} hat die Runde gewonnen!`
                        : "Unentschieden. Beide Spieler erhalten einen Punkt!"
                }`;

                await sendNotification(player1, roundSummary, "Die nächste Runde beginnt jetzt.", {
                    duelId,
                    currentRound: duelData.currentRound,
                    score
                });

                await sendNotification(player2, roundSummary, "Die nächste Runde beginnt jetzt.", {
                    duelId,
                    currentRound: duelData.currentRound,
                    score
                });
            }
        }

        if (!allAnswered) {
            const nextPlayer = isPlayer1 ? player2 : player1;
            await sendNotification(nextPlayer, "Du bist dran!", "Es ist deine Runde. Beantworte die nächste Frage.", {
                duelId
            });

            await sendNotification(userId, "Warten auf Gegner", "Dein Gegner ist jetzt an der Reihe.", {
                duelId
            });
        }

        await duelRef.update({
            rounds,
            score,
            currentRound: duelData.currentRound,
            currentTurn: updatedTurn,
            status: duelData.status
        });

        res.status(200).json({
            message: "Answer processed successfully.",
            isCorrect,
            correctAnswer: isCorrect ? null : correctAnswerText,
            updatedTurn,
            score
        });
    } catch (error) {
        res.status(500).json({ error: "Error processing answer: " + error.message });
    }
});
  
  


interface DuelData {
    player1: string;
    player2: string;
    currentTurn: string;
    currentRound: number;
    rounds: Array<{
        roundNumber: number;
        player1Answers: Array<{ id: string; status: string }>;
        player2Answers: Array<{ id: string; status: string }>;
    }>;
    score: Record<string, number>;
    status: string;
}


interface QuestionData {
    correctAnswerId: string;
    questionText: string;
    answers: Array<{ id: string; text: string }>;
}






