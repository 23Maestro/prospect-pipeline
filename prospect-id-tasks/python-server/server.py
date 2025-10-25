#!/usr/bin/env python3
"""
Python HTTP server wrapper for NPID API client
Exposes email sending functionality to Next.js Kanban app
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import sys
import os

# Add parent directory to path to import npid_api_client
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../src/python'))

from npid_api_client import NPIDAPIClient

app = Flask(__name__)
CORS(app)  # Enable CORS for Next.js frontend

client = NPIDAPIClient()

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'service': 'npid-email-server'})

@app.route('/send-email', methods=['POST'])
def send_email():
    """
    Send email to athlete via NPID

    Request body:
    {
        "athlete_name": "John Smith",
        "template_name": "Editing Done"
    }
    """
    data = request.json
    athlete_name = data.get('athlete_name')
    template_name = data.get('template_name')

    if not athlete_name or not template_name:
        return jsonify({
            'success': False,
            'error': 'Missing athlete_name or template_name'
        }), 400

    try:
        result = client.send_email_to_athlete(athlete_name, template_name)
        return jsonify(result)
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/search-player', methods=['POST'])
def search_player():
    """
    Search for player in NPID

    Request body:
    {
        "query": "John Smith"
    }
    """
    data = request.json
    query = data.get('query')

    if not query:
        return jsonify({
            'success': False,
            'error': 'Missing query parameter'
        }), 400

    try:
        results = client.search_player(query)
        return jsonify({
            'success': True,
            'data': results
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/get-athlete-details', methods=['POST'])
def get_athlete_details():
    """
    Get detailed athlete information by player_id

    Request body:
    {
        "player_id": "NPID-12345"
    }
    """
    data = request.json
    player_id = data.get('player_id')

    if not player_id:
        return jsonify({
            'success': False,
            'error': 'Missing player_id'
        }), 400

    try:
        details = client.get_athlete_details(player_id)
        return jsonify({
            'success': True,
            'data': details
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('DEBUG', 'false').lower() == 'true'

    print(f"Starting NPID Email Server on port {port}...")
    print(f"Debug mode: {debug}")

    app.run(
        host='0.0.0.0',
        port=port,
        debug=debug
    )
