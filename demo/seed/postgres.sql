-- The same products as the Elasticsearch index, for the Postgres side of the demo.
-- Runs once, when the database is created (docker-entrypoint-initdb.d).
create table products (
  id          serial primary key,
  name        text not null,
  category    text not null,
  description text,
  price       numeric(10, 2) not null
);

\set content `cat /data/products.json`
insert into products (name, category, description, price)
select name, category, description, price
from json_populate_recordset(null::products, :'content');
