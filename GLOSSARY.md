# Glossary

**Duo**
The two players who queue together in GeoGuessr ranked team duels. The unit everything in geo-coach belongs to.
_Avoid_: team (reserved for if there are ever multiple Duos), party

**Game**
One GeoGuessr ranked team duel played by the Duo, made up of Rounds.
_Avoid_: match, duel

**Round**
One location within a Game, which the Duo guesses on.

**Learning**
A piece of reusable knowledge the Duo said aloud, such as a clue, a meta, or a mistake to avoid ("Bulgaria has yellow-top bollards"). The main thing geo-coach exists to keep.
_Avoid_: note, tip

**Utterance**
A timestamped piece of speech by one player, as transcribed.

**Session**
One sitting where the Duo is in call and recording. It covers several Games and the talk between them, which also matters as context.
_Avoid_: stream, call

**Transcript**
The text version of one player's speech in a Session, made of Utterances. A Transcript can be redone; each redo is a new version, and the parts it changes need processing again.

**Processing run**
One manual pass of an AI agent over part of a Session that produces Learnings. Any part can be processed again, possibly by a different agent; the new run replaces that part's earlier Learnings.

**Companion**
The program each player runs on their own PC. It keeps that player's audio and turns it into their Transcript.
_Avoid_: client, helper, recorder
