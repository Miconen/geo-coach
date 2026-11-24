-- Read-only preflight before #56 step 0a deploys. Reports, never blocks.
-- Run against production with a read-only role: psql "$DATABASE_URL" -f docs/release/0a-preflight.sql

select count(*) as games_with_non_array_rounds
from games
where raw_duel ? 'rounds' and jsonb_typeof(raw_duel -> 'rounds') <> 'array';

select count(*) as rounds_numbered_le_zero from rounds where round_number <= 0;

-- Rows the Duo-agreement predicates will now hide.
select count(*) as recordings_session_other_duo
from recordings r join sessions s on s.id = r.session_id where s.duo_id <> r.duo_id;

select count(*) as runs_session_other_duo
from processing_runs pr join sessions s on s.id = pr.session_id where s.duo_id <> pr.duo_id;

select count(*) as rounds_game_other_duo
from rounds r join games g on g.id = r.game_id where g.duo_id <> r.duo_id;

select count(*) as utterances_chain_mismatch
from utterances u
join transcript_versions tv on tv.id = u.transcript_version_id
join recordings r on r.id = u.recording_id
where tv.recording_id <> u.recording_id or tv.duo_id <> u.duo_id or r.duo_id <> u.duo_id;
