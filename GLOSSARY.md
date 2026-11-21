# Glossary

**Duo**
A fixed pair of players who play GeoGuessr ranked team duels together; GeoGuessr calls this a team. The unit everything in geo-coach belongs to. A player can be in several Duos with different partners.
_Avoid_: party

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
One sitting where the Duo is in call and at least one player is recording. It covers several Games and the talk between them, which also matters as context. Players never start or end a Session themselves; it is formed from their Recordings. A Session where only one player recorded is a normal Session.
_Avoid_: stream, call

**Recording**
One player's continuous capture of their own mic for one Duo, from pressing Start until Stop, an automatic stop, or a crash. A Session is made of one or more Recordings from one or both players.
_Avoid_: track, take

**Transcript**
The text version of one Recording, made of Utterances. A player's speech in a Session is the union of their Transcripts. A Transcript can be redone; each redo is a new version, and the parts it changes need processing again.

**Processing run**
One manual pass of an AI agent over part of a Session that produces Learnings. Any part can be processed again, possibly by a different agent; the new run replaces that part's earlier Learnings.

**Companion**
The program each player runs on their own PC. It keeps that player's audio and turns it into their Transcript.
_Avoid_: client, helper, recorder
