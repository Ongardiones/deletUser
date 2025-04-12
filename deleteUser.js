import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceRoleKey);

export default async function deleteUser(req, res) {
    // Configurar encabezados CORS
    res.setHeader('Access-Control-Allow-Origin', '*'); // Permitir solicitudes desde cualquier origen
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); // Métodos permitidos
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); // Encabezados permitidos

    // Manejar solicitudes OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'Falta el userId' });
    }

    try {
        const { error } = await supabase.auth.admin.deleteUser(userId);
        if (error) {
            throw error;
        }

        res.status(200).json({ message: 'Usuario eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar el usuario:', error.message);
        res.status(500).json({ error: 'Error al eliminar el usuario' });
    }
}
