// src/services/api.js
const API_BASE = import.meta.env.VITE_API_BASE_URL;

export const api = {
    upload: (file) => {
        const formData = new FormData();
        formData.append("file", file);
        return fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
    },
    getParty: () => fetch(`${API_BASE}/party`).then(res => res.json()),
    updateMoney: (amount) => fetch(`${API_BASE}/money/update?amount=${amount}`, { method: "POST" }),
    download: () => window.location.href = `${API_BASE}/download`,
    saveAll: () => fetch(`${API_BASE}/save-all`, { method: "POST" }),
};
