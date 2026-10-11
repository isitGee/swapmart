-- Creates the isolated database used by the automated test suites.
-- Loaded automatically by docker-compose on first start.
SELECT 'CREATE DATABASE swapmart_test OWNER swapmart'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'swapmart_test') \gexec
