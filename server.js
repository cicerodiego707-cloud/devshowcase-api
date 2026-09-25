const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 🏛️ 1. CONEXÃO COM O BANCO DE DADOS POSTGRESQL NA NUVEM
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
});// Inicialização automática das tabelas no PostgreSQL (Adequando a sintaxe SERIAL e tipos)
const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS Profile (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                bio TEXT,
                email TEXT UNIQUE NOT NULL
            );
            CREATE TABLE IF NOT EXISTS Technology (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL
            );
            CREATE TABLE IF NOT EXISTS Project (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                githubUrl TEXT NOT NULL,
                profileId INTEGER REFERENCES Profile(id) ON DELETE CASCADE,
                upvotes INTEGER DEFAULT 0,
                averageRating NUMERIC(3,2) DEFAULT 0.00
            );
            CREATE TABLE IF NOT EXISTS Feedback (
                id SERIAL PRIMARY KEY,
                comment TEXT NOT NULL,
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                projectId INTEGER REFERENCES Project(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS ProjectTechnologies (
                projectId INTEGER REFERENCES Project(id) ON DELETE CASCADE,
                technologyId INTEGER REFERENCES Technology(id) ON DELETE CASCADE,
                PRIMARY KEY (projectId, technologyId)
            );
        `);
        console.log("🏛️ Banco de dados PostgreSQL (Supabase) sincronizado com sucesso!");
    } catch (err) {
        console.error("❌ Erro ao inicializar tabelas no Postgres:", err.message);
    }
};
initDb();

// Função auxiliar de validação sintática de URL
function isValidUrl(string) {
    try { new URL(string); return true; } catch (_) { return false; }
}

// ================================================================================
// 📋 ENDPOINTS REST DA ETAPA 1 (ADAPTADOS PARA POSTGRESQL)
// ================================================================================

app.post('/api/profiles', async (req, res, next) => {
    try {
        const { name, bio, email } = req.body;
        if (!name || name.trim() === "" || !email || email.trim() === "") {
            return res.status(400).json({ error: "Campos obrigatórios 'name' e 'email' não podem ser vazios." });
        }
        const result = await pool.query(
            'INSERT INTO Profile (name, bio, email) VALUES (\$1, \$2, \$3) RETURNING *',
            [name, bio, email]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) { next(err); }
});

app.get('/api/profiles/:id', async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM Profile WHERE id = \$1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Perfil não encontrado." });
        res.json(result.rows[0]);
    } catch (err) { next(err); }
});

app.post('/api/technologies', async (req, res, next) => {
    try {
        const { name } = req.body;
        if (!name || name.trim() === "") return res.status(400).json({ error: "O campo 'name' é obrigatório." });
        const result = await pool.query('INSERT INTO Technology (name) VALUES (\$1) RETURNING *', [name]);
        res.status(201).json(result.rows[0]);
    } catch (err) { next(err); }
});

app.get('/api/technologies', async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM Technology');
        res.json(result.rows);
    } catch (err) { next(err); }
});

app.post('/api/projects', async (req, res, next) => {
    try {
        const { title, description, githubUrl, profileId, technologyIds } = req.body;
        if (!title || title.trim() === "" || !description || description.trim() === "") {
            return res.status(400).json({ error: "Título e descrição não podem ser vazios." });
        }
        if (!githubUrl || !isValidUrl(githubUrl)) return res.status(400).json({ error: "URL do GitHub inválida." });

        const result = await pool.query(
            'INSERT INTO Project (title, description, githubUrl, profileId) VALUES (\$1, \$2, \$3, \$4) RETURNING *',
            [title, description, githubUrl, profileId]
        );
        const newProject = result.rows[0];

        if (technologyIds && Array.isArray(technologyIds)) {
            for (const techId of technologyIds) {
                await pool.query('INSERT INTO ProjectTechnologies (projectId, technologyId) VALUES (\$1, \$2)', [newProject.id, techId]);
            }
        }
        res.status(201).json({ ...newProject, technologyIds });
    } catch (err) { next(err); }
});

// ================================================================================
// 🚀 REQUISITOS TÉCNICOS DA ETAPA 2 (NOVOS ENDPOINTS REST E REGRAS AVANÇADAS)
// ================================================================================

// 1. POST /api/projects/{id}/feedbacks (Cadastrar feedback com cálculo de média automático)
app.post('/api/projects/:id/feedbacks', async (req, res, next) => {
    try {
        const projectId = req.params.id;
        const { comment, rating } = req.body;

        if (!comment || comment.trim() === "") return res.status(400).json({ error: "O comentário é obrigatório." });
        if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "A nota (rating) deve ser entre 1 e 5." });

        const projectCheck = await pool.query('SELECT id FROM Project WHERE id = \$1', [projectId]);
        if (projectCheck.rows.length === 0) return res.status(404).json({ error: "Projeto não encontrado." });

        const feedbackResult = await pool.query(
            'INSERT INTO Feedback (comment, rating, projectId) VALUES (\$1, \$2, \$3) RETURNING *',
            [comment, rating, projectId]
        );

        const stats = await pool.query('SELECT AVG(rating) as media FROM Feedback WHERE projectId = \$1', [projectId]);
        const novaMedia = parseFloat(stats.rows[0].media).toFixed(2);
        
        await pool.query('UPDATE Project SET averageRating = \$1 WHERE id = \$2', [novaMedia, projectId]);

        res.status(201).json({
            message: "Feedback cadastrado com sucesso!",
            feedback: feedbackResult.rows[0],
            projectAverageRatingUpdated: novaMedia
        });
    } catch (err) { next(err); }
});

// 2. PUT /api/projects/{id}/upvote (Atualizar curtidas/estrelas incrementando-as)
app.put('/api/projects/:id/upvote', async (req, res, next) => {
    try {
        const projectId = req.params.id;
        const check = await pool.query('SELECT id FROM Project WHERE id = \$1', [projectId]);
        if (check.rows.length === 0) return res.status(404).json({ error: "Projeto não encontrado." });

        const result = await pool.query(
            'UPDATE Project SET upvotes = upvotes + 1 WHERE id = \$1 RETURNING *',
            [projectId]
        );
        res.json({ message: "Upvote computado com sucesso!", project: result.rows[0] });
    } catch (err) { next(err); }
});

// 3. GET /api/projects (Buscar com filtragem por tecnologia e paginação)
app.get('/api/projects', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const techId = req.query.technologyId;
        const offset = (page - 1) * limit;

        let queryStr = `SELECT p.* FROM Project p`;
        let queryParams = [];

        if (techId) {
            queryStr += ` JOIN ProjectTechnologies pt ON p.id = pt.projectId WHERE pt.technologyId = $1`;
            queryParams.push(techId);
        }

        queryStr += ` ORDER BY p.id DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
        queryParams.push(limit, offset);

        const result = await pool.query(queryStr, queryParams);
        res.json({
            page,
            limit,
            count: result.rows.length,
            projects: result.rows
        });
    } catch (err) { next(err); }
});

// ================================================================================
// 🛡️ 2. MANIPULADOR GLOBAL DE EXCEÇÕES (TRATAMENTO DE ERROS AMIGÁVEL)
// ================================================================================
app.use((err, req, res, next) => {
    console.error("🛡️ Log de Erro Global:", err.message);
    if (err.code === '23505') {
        return res.status(400).json({ error: "Operação inválida. Este registro ou e-mail já existe." });
    }
    if (err.code === '23503') {
        return res.status(400).json({ error: "Erro de consistência. O ID informado não existe." });
    }
    res.status(500).json({ error: "Ocorreu um erro interno no servidor de banco de dados." });
});

app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 DEVSHOWCASE API ADVANCED ONLINE NA PORTA ${PORT}`);
    console.log(`====================================================`);
});