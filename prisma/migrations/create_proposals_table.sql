-- Migration: Create Proposals Table

CREATE TABLE proposals (
    id SERIAL PRIMARY KEY,
    client_id INT NOT NULL,
    sales_user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (sales_user_id) REFERENCES users(id)
);

CREATE TABLE proposal_hoardings (
    id SERIAL PRIMARY KEY,
    proposal_id INT NOT NULL,
    hoarding_id INT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    FOREIGN KEY (proposal_id) REFERENCES proposals(id),
    FOREIGN KEY (hoarding_id) REFERENCES hoardings(id)
);