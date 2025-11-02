-- bigquery/02_pageviews_by_campaign.sql
-- Shows pageviews grouped by first-touch traffic source derived from GA4 export.
DECLARE start_date STRING DEFAULT '2025-10-25';
DECLARE end_date   STRING DEFAULT '2025-11-01';

WITH events AS (
  SELECT event_date, event_name, traffic_source, user_pseudo_id, event_params
  FROM `your_project.your_dataset.events_*`
  WHERE _TABLE_SUFFIX BETWEEN REPLACE(start_date, '-', '') AND FORMAT_DATE('%Y%m%d', DATE(end_date) - 1)
    AND event_name = 'page_view'
)
SELECT
  PARSE_DATE('%Y%m%d', event_date) AS date,
  COALESCE(traffic_source.source, '(not set)')   AS source,
  COALESCE(traffic_source.medium, '(not set)')   AS medium,
  COALESCE(traffic_source.name, '(not set)')     AS campaign,
  COUNT(*) AS pageviews
FROM events
GROUP BY date, source, medium, campaign
ORDER BY date DESC, pageviews DESC
LIMIT 1000;
