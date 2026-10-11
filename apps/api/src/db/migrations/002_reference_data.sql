-- =============================================================================
-- SWAPMART — reference data (migration 002)
-- Categories and brands are platform reference data rather than demo content,
-- so they are seeded by an idempotent migration and are safe to re-run.
-- =============================================================================

INSERT INTO categories (slug, name, description, icon, sort_order) VALUES
  ('smartphones',     'Smartphones',      'Android and iOS handsets, new and pre-owned.',                    'smartphone', 10),
  ('laptops',         'Laptops',          'Business, student and gaming laptops, chargers included.',        'laptop',     20),
  ('tablets',         'Tablets',          'Tablets and detachable 2-in-1 devices.',                          'tablet',     30),
  ('gaming-consoles', 'Gaming consoles',  'Home and handheld consoles with accessories.',                    'gamepad',    40),
  ('smartwatches',    'Smartwatches',     'Wearables, fitness bands and accessories.',                       'watch',      50),
  ('cameras',         'Cameras',          'DSLR, mirrorless and action cameras plus lenses.',                'camera',     60),
  ('audio',           'Audio equipment',  'Headphones, speakers, mixers and studio gear.',                   'speaker',    70),
  ('accessories',     'Accessories',      'Chargers, keyboards, monitors, docks and cables.',                'plug',       80),
  ('other',           'Other electronics','Consumer electronics that do not fit the categories above.',      'box',        90)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      sort_order = EXCLUDED.sort_order;

INSERT INTO brands (slug, name) VALUES
  ('apple','Apple'), ('samsung','Samsung'), ('tecno','Tecno'), ('infinix','Infinix'),
  ('itel','itel'), ('huawei','Huawei'), ('xiaomi','Xiaomi'), ('redmi','Redmi'),
  ('oppo','Oppo'), ('vivo','Vivo'), ('nokia','Nokia'), ('oneplus','OnePlus'),
  ('google','Google'), ('hp','HP'), ('dell','Dell'), ('lenovo','Lenovo'), ('asus','Asus'),
  ('acer','Acer'), ('toshiba','Toshiba'), ('microsoft','Microsoft'), ('sony','Sony'),
  ('lg','LG'), ('jbl','JBL'), ('anker','Anker'), ('canon','Canon'), ('nikon','Nikon'),
  ('nintendo','Nintendo'), ('realme','Realme'), ('amazon','Amazon'), ('garmin','Garmin')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO reference_counters (scope, next_value) VALUES
  ('RPT', 1), ('DSP', 1), ('TXN', 1), ('LST', 1)
ON CONFLICT (scope) DO NOTHING;
