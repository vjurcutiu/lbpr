-- bigquery/01_verify_pageviews.sql
-- Replace your_project.your_dataset with the GA4 export dataset you linked in GA Admin.
-- Counts page_view events per day in a date range.
DECLARE start_date STRING DEFAULT '2025-10-25';
DECLARE end_date   STRING DEFAULT '2025-11-01'; -- exclusive upper bound for _TABLE_SUFFIX filter

WITH events AS (
  SELECT *
  FROM `your_project.your_dataset.events_*`
  WHERE _TABLE_SUFFIX BETWEEN REPLACE(start_date, '-', '') AND FORMAT_DATE('%Y%m%d', DATE(end_date) - 1)
    AND event_name = 'page_view'
)
SELECT
  PARSE_DATE('%Y%m%d', event_date) AS date,
  COUNT(*) AS pageviews
FROM events
GROUP BY date
ORDER BY date;
