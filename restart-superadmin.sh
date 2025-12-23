#!/bin/bash
# Script para actualizar el código y reiniciar PM2

echo "🔄 Actualizando código desde Git..."
git pull

echo "🔄 Reiniciando PM2..."
pm2 restart agendaloya

echo "📋 Mostrando logs (Ctrl+C para salir)..."
sleep 2
pm2 logs agendaloya --lines 30
