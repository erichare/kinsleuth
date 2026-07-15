CREATE INDEX sync_changes_run_classification_page_idx
  ON public.sync_changes (archive_id, run_id, classification, sort_order, id);
