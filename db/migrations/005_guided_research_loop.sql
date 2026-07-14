-- Expand the case research model for the private guided-research loop. Keep
-- every new column compatible with the previous release's writers: legacy
-- inserts can omit the fields, and legacy rows do not gain invented history.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE public.hypotheses
  ADD COLUMN decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN updated_at timestamptz;

ALTER TABLE public.tasks
  ADD COLUMN origin text NOT NULL DEFAULT 'manual',
  ADD COLUMN priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN guide_key text,
  ADD COLUMN work_fingerprint text NOT NULL DEFAULT '',
  ADD COLUMN guidance text NOT NULL DEFAULT '',
  ADD COLUMN target_hypothesis_id text,
  ADD COLUMN context_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN updated_at timestamptz;

-- Mirror the application's title normalization for tasks that predate guided
-- research. This is the only legacy value we can derive without fabricating a
-- decision, outcome, actor, reason, or timestamp.
UPDATE public.tasks
SET work_fingerprint = btrim(
  regexp_replace(
    regexp_replace(
      normalize(lower(title), NFKD),
      U&'[\0300-\036f]+',
      '',
      'g'
    ),
    '[^a-z0-9]+',
    ' ',
    'g'
  )
);

ALTER TABLE public.hypotheses
  ADD CONSTRAINT hypotheses_decisions_array_check
    CHECK (jsonb_typeof(decisions) = 'array'),
  ADD CONSTRAINT hypotheses_archive_case_id_key
    UNIQUE (archive_id, case_id, id);

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_origin_check
    CHECK (origin IN ('manual', 'guide')),
  ADD CONSTRAINT tasks_priority_check
    CHECK (priority IN ('high', 'normal', 'low')),
  ADD CONSTRAINT tasks_guide_key_origin_check
    CHECK (guide_key IS NULL OR origin = 'guide'),
  ADD CONSTRAINT tasks_context_refs_array_check
    CHECK (jsonb_typeof(context_refs) = 'array'),
  ADD CONSTRAINT tasks_outcomes_array_check
    CHECK (jsonb_typeof(outcomes) = 'array'),
  ADD CONSTRAINT tasks_archive_case_target_hypothesis_fkey
    FOREIGN KEY (archive_id, case_id, target_hypothesis_id)
    REFERENCES public.hypotheses (archive_id, case_id, id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX tasks_archive_case_guide_key_unique_idx
  ON public.tasks (archive_id, case_id, guide_key)
  WHERE guide_key IS NOT NULL;

-- The guide resumes doing work first, then presents to-do work by semantic
-- priority and persisted order. Keep completed work out of this small index.
CREATE INDEX tasks_next_assignment_idx
  ON public.tasks (
    archive_id,
    case_id,
    (CASE status WHEN 'doing' THEN 0 ELSE 1 END),
    (CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END),
    sort_order,
    id
  )
  WHERE status IN ('doing', 'todo');
