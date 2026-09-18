const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

// Permite que a API receba dados em formato JSON (exigido para os POSTs)
app.use(express.json());

// 🏛️ 1. CONFIGURAÇÃO E CRIAÇÃO AUTOMÁTICA DO BANCO DE DADOS RELACIONAL (SQLite)
const dbPath = path.resolve(__dirname, 'dev.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Erro ao abrir banco de dados:", err.message);
    } else {
        console.log("Banco de dados relacional SQLite conectado com sucesso!");
    }
});

// Inicialização automática das tabelas e relacionamentos lógicos (Requisito 2)
db.serialize(() => {
    // Tabela Profile (Perfil do Desenvolvedor)
    db.run(`CREATE TABLE IF NOT EXISTS Profile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        bio TEXT,
        email TEXT UNIQUE NOT NULL
    )`);

    // Tabela Technology (Tecnologia)
    db.run(`CREATE TABLE IF NOT EXISTS Technology (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
    )`);

    // Tabela Project (Projeto) - Relacionamento Profile 1 : N Project (Chave estrangeira profileId)
    db.run(`CREATE TABLE IF NOT EXISTS Project (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        githubUrl TEXT NOT NULL,
        profileId INTEGER,
        FOREIGN KEY (profileId) REFERENCES Profile(id) ON DELETE CASCADE
    )`);

    // Tabela Feedback (Opinião) - Relacionamento Project 1 : N Feedback (Chave estrangeira projectId)
    db.run(`CREATE TABLE IF NOT EXISTS Feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comment TEXT NOT NULL,
        rating INTEGER NOT NULL,
        projectId INTEGER,
        FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
    )`);

    // Tabela de Junção / Pivot (Project N : N Technology)
    db.run(`CREATE TABLE IF NOT EXISTS ProjectTechnologies (
        projectId INTEGER,
        technologyId INTEGER,
        PRIMARY KEY (projectId, technologyId),
        FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE,
        FOREIGN KEY (technologyId) REFERENCES Technology(id) ON DELETE CASCADE
    )`);
});

// 📌 FUNÇÃO DE VALIDAÇÃO DE URL (Simulando as restrições de DTO do Requisito 3)
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// 📋 2. IMPLEMENTAÇÃO DOS ENDPOINTS REST (Requisito 4)

// [POST] /api/profiles - Cadastro de perfil com validações
app.post('/api/profiles', (req, res) => {
    const { name, bio, email } = req.body;
    
    // Validação de campos obrigatórios (DTO de entrada)
    if (!name || name.trim() === "" || !email || email.trim() === "") {
        return res.status(400).json({ error: "Campos obrigatórios 'name' e 'email' não podem ser vazios." });
    }

    db.run(`INSERT INTO Profile (name, bio, email) VALUES (?, ?, ?)`, [name, bio, email], function(err) {
        if (err) return res.status(400).json({ error: "E-mail já cadastrado ou erro no banco." });
        
        // Retorna o DTO de Saída
        res.status(201).json({ id: this.lastID, name, bio, email });
    });
});

// [GET] /api/profiles/{id} - Buscar perfil por id
app.get('/api/profiles/:id', (req, res) => {
    db.get(`SELECT * FROM Profile WHERE id = ?`, [req.params.id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: "Perfil não encontrado." });
        res.json(row);
    });
});

// [POST] /api/technologies - Cadastro de tecnologia com validações
app.post('/api/technologies', (req, res) => {
    const { name } = req.body;
    
    // Validação de campo obrigatório
    if (!name || name.trim() === "") {
        return res.status(400).json({ error: "O campo 'name' da tecnologia é obrigatório e não pode ser vazio." });
    }

    db.run(`INSERT INTO Technology (name) VALUES (?)`, [name], function(err) {
        if (err) return res.status(400).json({ error: "Tecnologia já cadastrada no sistema." });
        res.status(201).json({ id: this.lastID, name });
    });
});

// [GET] /api/technologies - Listagem de todas as tecnologias
app.get('/api/technologies', (req, res) => {
    db.all(`SELECT * FROM Technology`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// [POST] /api/projects - Cadastro de projeto com validações e vinculação N:N
app.post('/api/projects', (req, res) => {
    const { title, description, githubUrl, profileId, technologyIds } = req.body;
    
    // Validações obrigatórias de títulos e strings não vazias (Requisito 3)
    if (!title || title.trim() === "" || !description || description.trim() === "") {
        return res.status(400).json({ error: "Título e descrição são obrigatórios e não podem ser vazios." });
    }
    
    // Validação de formato de URL obrigatória (Requisito 3)
    if (!githubUrl || !isValidUrl(githubUrl)) {
        return res.status(400).json({ error: "A URL do GitHub informada é inválida ou vazia." });
    }

    db.run(`INSERT INTO Project (title, description, githubUrl, profileId) VALUES (?, ?, ?, ?)`,
        [title, description, githubUrl, profileId], function(err) {
            if (err) return res.status(400).json({ error: err.message });
            const projectId = this.lastID;

            // Sincronizando o relacionamento Muitos para Muitos (N:N) com as tecnologias informadas
            if (technologyIds && Array.isArray(technologyIds)) {
                technologyIds.forEach(techId => {
                    db.run(`INSERT INTO ProjectTechnologies (projectId, technologyId) VALUES (?, ?)`, [projectId, techId]);
                });
            }
            res.status(201).json({ id: projectId, title, description, githubUrl, profileId, technologyIds });
        }
    );
});

// [GET] /api/projects - Listagem de todos os projetos
app.get('/api/projects', (req, res) => {
    db.all(`SELECT * FROM Project`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 🚀 Inicialização Oficial do Servidor Back-end
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 DEVSHOWCASE API RODANDO COM SUCESSO NA PORTA ${PORT}`);
    console.log(`====================================================`);
});
