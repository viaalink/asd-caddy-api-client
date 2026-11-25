-- The same products as the Elasticsearch index and Postgres, for MySQL and MariaDB.
-- Runs once, when the database is created (docker-entrypoint-initdb.d).
-- Written from data/products.json; keep the two in step.
--
-- category is binary (utf8mb4_bin): MySQL and MariaDB compare text without case
-- by default, and the shop's lower-case category slugs should miss here as
-- they do in Postgres (the demo's first bug).
create table products (
  id          int auto_increment primary key,
  name        varchar(200) not null,
  category    varchar(50) collate utf8mb4_bin not null,
  description text,
  price       decimal(10, 2) not null
);

insert into products (name, category, description, price) values
  ('Wireless Bluetooth Headphones', 'Electronics', 'Premium noise-canceling headphones with 30-hour battery life', 199.99),
  ('Mechanical Keyboard', 'Electronics', 'RGB backlit mechanical keyboard with Cherry MX switches', 149.99),
  ('USB-C Hub', 'Electronics', '7-in-1 USB-C hub with HDMI, USB 3.0, and SD card reader', 49.99),
  ('Wireless Mouse', 'Electronics', 'Ergonomic wireless mouse with adjustable DPI', 39.99),
  ('Laptop Stand', 'Electronics', 'Adjustable aluminum laptop stand for better ergonomics', 59.99),
  ('Webcam HD', 'Electronics', '1080p HD webcam with built-in microphone', 79.99),
  ('Smart Watch', 'Electronics', 'Fitness tracker with heart rate monitor and GPS', 249.99),
  ('Portable SSD', 'Electronics', '1TB portable SSD with USB 3.2 for fast transfers', 129.99),
  ('Running Shoes', 'Sports', 'Lightweight running shoes with breathable mesh', 89.99),
  ('Yoga Mat', 'Sports', 'Non-slip yoga mat with carrying strap', 29.99),
  ('Dumbbell Set', 'Sports', 'Adjustable dumbbell set 5-50 lbs', 299.99),
  ('Tennis Racket', 'Sports', 'Professional tennis racket with carbon fiber frame', 159.99),
  ('Basketball', 'Sports', 'Official size indoor/outdoor basketball', 34.99),
  ('Cycling Helmet', 'Sports', 'Lightweight cycling helmet with ventilation', 69.99),
  ('Resistance Bands', 'Sports', 'Set of 5 resistance bands with different strengths', 24.99),
  ('Coffee Maker', 'Kitchen', '12-cup programmable coffee maker with thermal carafe', 79.99),
  ('Air Fryer', 'Kitchen', '5.8 quart air fryer with digital display', 99.99),
  ('Blender', 'Kitchen', 'High-powered blender for smoothies and soups', 69.99),
  ('Cast Iron Skillet', 'Kitchen', 'Pre-seasoned 12-inch cast iron skillet', 44.99),
  ('Knife Set', 'Kitchen', '15-piece stainless steel knife set with block', 129.99),
  ('Instant Pot', 'Kitchen', '6-quart multi-cooker with 7 cooking functions', 89.99),
  ('Electric Kettle', 'Kitchen', '1.7L stainless steel electric kettle', 39.99),
  ('Toaster Oven', 'Kitchen', 'Convection toaster oven with air fry function', 149.99),
  ('Desk Lamp', 'Home', 'LED desk lamp with adjustable brightness and color temperature', 34.99),
  ('Throw Blanket', 'Home', 'Soft fleece throw blanket 50x60 inches', 29.99),
  ('Picture Frame Set', 'Home', 'Set of 6 black picture frames various sizes', 39.99),
  ('Indoor Plant Pot', 'Home', 'Ceramic plant pot with drainage hole', 19.99),
  ('Wall Clock', 'Home', 'Modern minimalist wall clock 12 inches', 24.99),
  ('Bookshelf', 'Home', '5-tier wooden bookshelf with industrial design', 89.99),
  ('Candle Set', 'Home', 'Set of 3 scented soy candles', 34.99),
  ('Backpack', 'Bags', 'Water-resistant laptop backpack with USB port', 49.99),
  ('Messenger Bag', 'Bags', 'Canvas messenger bag with leather trim', 59.99),
  ('Duffel Bag', 'Bags', 'Large gym duffel bag with shoe compartment', 44.99),
  ('Travel Organizer', 'Bags', 'Set of 6 packing cubes for luggage', 24.99),
  ('Wallet', 'Bags', 'Genuine leather bifold wallet with RFID blocking', 39.99),
  ('Programming Book', 'Books', 'Clean Code: A Handbook of Agile Software Craftsmanship', 44.99),
  ('Science Fiction Novel', 'Books', 'Dune by Frank Herbert - Classic sci-fi epic', 16.99),
  ('Cookbook', 'Books', 'The Food Lab: Better Home Cooking Through Science', 39.99),
  ('Self-Help Book', 'Books', 'Atomic Habits by James Clear', 19.99),
  ('History Book', 'Books', 'Sapiens: A Brief History of Humankind', 24.99),
  ('Sunglasses', 'Accessories', 'Polarized sunglasses with UV protection', 79.99),
  ('Watch', 'Accessories', 'Minimalist analog watch with leather strap', 129.99),
  ('Phone Case', 'Accessories', 'Shockproof phone case with card holder', 24.99),
  ('Belt', 'Accessories', 'Reversible leather belt black/brown', 34.99),
  ('Scarf', 'Accessories', 'Cashmere blend winter scarf', 49.99),
  ('Board Game', 'Games', 'Catan - Strategy board game for 3-4 players', 44.99),
  ('Puzzle', 'Games', '1000-piece jigsaw puzzle landscape scene', 19.99),
  ('Card Game', 'Games', 'Premium playing cards set of 2 decks', 14.99),
  ('Chess Set', 'Games', 'Wooden chess set with folding board', 39.99),
  ('Video Game', 'Games', 'The Legend of Zelda: Tears of the Kingdom', 59.99);
