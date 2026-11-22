# Glossary

**Duo**
A fixed pair of players who play GeoGuessr ranked team duels together; GeoGuessr calls this a team. The unit everything in geo-coach belongs to. A player can be in several Duos with different partners.
_Avoid_: party

**Player**
A person who uses geo-coach, belonging to one or more Duos.
_Avoid_: member, user

**Opponent**
A GeoGuessr player on the other team in a Game. Opponents never use geo-coach.

**Game**
One GeoGuessr ranked team duel played by the Duo, made up of Rounds.
_Avoid_: match, duel

**Map**
The GeoGuessr map a Game is played on, such as "A Pro World". The geographic view on the statistics page is the "map view", never a Map.

**Mode**
The movement rules a Game is played with: Moving, NoMove (NM), or NMPZ (no move, pan or zoom).

**Round**
One location within a Game, which the Duo guesses on.

**Region**
A first-level subdivision of a country as geo-coach groups it: a US state, a Brazilian state, a French region, a UK nation. Both a Round's location and each guess have one.
_Avoid_: subdivision, province, state (for the general idea)

**Learning**
A piece of reusable knowledge from a Session, such as a clue, a way to tell two countries apart, a mistake, a tactic, or something the Duo wants to study ("Bulgaria has yellow-top bollards"). Most come from what the Duo said aloud; some are Tips. The main thing geo-coach exists to keep.
_Avoid_: note, tip (for Learnings the Duo said)

**Tip**
A Learning an agent adds from its own knowledge, prompted by something the Duo said. It is still tied to those Utterances.
_Avoid_: advice, AI note

**Study item**
A Learning that names something the Duo wants to learn, rather than a fact ("we should learn Brazilian states"). A Player marks it done when they've covered it.
_Avoid_: todo, goal

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
One manual pass of an AI agent over part of a Session that produces Learnings. Each run has a purpose: extracting what the Duo said, or adding Tips. Any part can be processed again, possibly by a different agent; the new run replaces that part's earlier Learnings of the same purpose only.

**Companion**
The program each player runs on their own PC. It keeps that player's audio and turns it into their Transcript.
_Avoid_: client, helper, recorder
