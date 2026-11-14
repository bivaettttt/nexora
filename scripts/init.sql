CREATE ROLE crm LOGIN PASSWORD 'crm-local-db';
CREATE ROLE erp LOGIN PASSWORD 'erp-local-db';
CREATE ROLE billing LOGIN PASSWORD 'billing-local-db';
CREATE ROLE integration LOGIN PASSWORD 'integration-local-db';
CREATE DATABASE crm OWNER crm;
CREATE DATABASE erp OWNER erp;
CREATE DATABASE billing OWNER billing;
CREATE DATABASE integration OWNER integration;
REVOKE CONNECT ON DATABASE crm, erp, billing, integration FROM PUBLIC;
