-- SABOR DIGITAL — dados de demonstração (TODOS marcados is_demo = true). Preços fictícios.
INSERT INTO restaurants (identifier, name, phone, email, status, plan, is_demo)
VALUES ('REST-001', 'RESTaurante Sabor Digital', '21999999999', 'contato@sabordigital.example', 'active', 'premium', true);

-- 10 mesas; o token do QR é aleatório (default da coluna), nunca previsível
INSERT INTO tables (restaurant_id, identifier, number, capacity)
SELECT (SELECT id FROM restaurants WHERE identifier='REST-001'), 'MESA-' || lpad(n::text,3,'0'), n, 4
FROM generate_series(1,10) AS n;

INSERT INTO categories (restaurant_id, name, description, display_order) VALUES ((SELECT id FROM restaurants WHERE identifier='REST-001'), 'Hambúrgueres', 'Hambúrgueres artesanais', 1);
INSERT INTO categories (restaurant_id, name, description, display_order) VALUES ((SELECT id FROM restaurants WHERE identifier='REST-001'), 'Pizzas', 'Pizzas tradicionais e especiais', 2);
INSERT INTO categories (restaurant_id, name, description, display_order) VALUES ((SELECT id FROM restaurants WHERE identifier='REST-001'), 'Bebidas', 'Refrigerantes, sucos e águas', 3);
INSERT INTO categories (restaurant_id, name, description, display_order) VALUES ((SELECT id FROM restaurants WHERE identifier='REST-001'), 'Porções', 'Porções para compartilhar', 4);
INSERT INTO categories (restaurant_id, name, description, display_order) VALUES ((SELECT id FROM restaurants WHERE identifier='REST-001'), 'Sobremesas', 'Doces e sobremesas', 5);

-- Hambúrgueres
INSERT INTO products (restaurant_id, category_id, name, description, price, is_demo) VALUES
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Hambúrgueres' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'X-Burger', 'Pão, hambúrguer, queijo e molho especial', 25.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Hambúrgueres' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'X-Salada', 'Hambúrguer, queijo, alface e tomate', 29.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Hambúrgueres' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'X-Bacon', 'Hambúrguer, queijo e bacon crocante', 34.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Hambúrgueres' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'X-Tudo', 'Hambúrguer completo com tudo', 39.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Hambúrgueres' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Hambúrguer Artesanal', 'Hambúrguer artesanal 180g', 42.90, true);

-- Pizzas
INSERT INTO products (restaurant_id, category_id, name, description, price, is_demo) VALUES
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Pizzas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Pizza Marguerita', 'Molho, mussarela, tomate e manjericão', 39.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Pizzas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Pizza Calabresa', 'Molho, mussarela, calabresa e cebola', 44.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Pizzas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Pizza Quatro Queijos', 'Mussarela, provolone, gorgonzola e parmesão', 49.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Pizzas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Pizza Portuguesa', 'Presunto, ovos, cebola e azeitona', 47.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Pizzas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Pizza Frango com Catupiry', 'Frango desfiado e catupiry', 49.90, true);

-- Bebidas
INSERT INTO products (restaurant_id, category_id, name, description, price, is_demo) VALUES
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Bebidas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Coca-Cola 350ml', 'Refrigerante lata', 6.00, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Bebidas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Guaraná 350ml', 'Refrigerante lata', 6.00, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Bebidas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Água Mineral', 'Água mineral 500ml', 4.00, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Bebidas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Suco Natural', 'Suco natural 400ml', 9.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Bebidas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Refrigerante 1L', 'Refrigerante garrafa 1L', 12.00, true);

-- Porções
INSERT INTO products (restaurant_id, category_id, name, description, price, is_demo) VALUES
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Porções' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Batata Frita', 'Porção de batata frita crocante', 24.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Porções' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Batata com Cheddar', 'Batata frita com cheddar e bacon', 32.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Porções' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Frango à Passarinho', 'Frango temperado e frito', 39.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Porções' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Calabresa Acebolada', 'Calabresa frita com cebola', 34.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Porções' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Onion Rings', 'Anéis de cebola empanados', 27.90, true);

-- Sobremesas
INSERT INTO products (restaurant_id, category_id, name, description, price, is_demo) VALUES
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Sobremesas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Brownie', 'Brownie de chocolate', 12.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Sobremesas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Pudim', 'Pudim de leite condensado', 9.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Sobremesas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Sorvete', 'Sorvete 2 bolas', 10.00, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Sobremesas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Petit Gateau', 'Petit gateau com sorvete', 18.90, true),
  ((SELECT id FROM restaurants WHERE identifier='REST-001'), (SELECT id FROM categories WHERE name='Sobremesas' AND restaurant_id=(SELECT id FROM restaurants WHERE identifier='REST-001')), 'Cheesecake', 'Cheesecake de frutas vermelhas', 16.90, true);

-- Adicionais de exemplo
INSERT INTO product_addons (restaurant_id, product_id, name, price)
SELECT p.restaurant_id, p.id, a.name, a.price FROM products p
JOIN categories c ON c.id = p.category_id
JOIN (VALUES ('Hambúrgueres','Bacon extra',5.00),('Hambúrgueres','Queijo extra',3.00),('Hambúrgueres','Ovo',2.50),
             ('Pizzas','Borda recheada',8.00),('Porções','Molho extra',3.00)) AS a(cat,name,price) ON a.cat = c.name;
