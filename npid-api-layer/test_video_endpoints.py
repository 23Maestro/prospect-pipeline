#!/usr/bin/env python3
"""
Integration Tests for NPID Video Endpoints
Tests that FastAPI layer correctly mirrors Python client behavior.
"""

import httpx
import asyncio
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_URL = "http://localhost:8000"

# Test data (use real athlete from your system)
TEST_ATHLETE_ID = "1464473"
TEST_ATHLETE_MAIN_ID = "943406"
TEST_SPORT = "football"
TEST_VIDEO_TYPE = "Full Season Highlight"


async def test_health():
    """Test health endpoint"""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BASE_URL}/health")
        assert response.status_code == 200
        data = response.json()
        logger.info(f"✅ Health check: {data}")
        return data


async def test_seasons_endpoint():
    """Test video seasons endpoint with form-encoded request"""
    async with httpx.AsyncClient() as client:
        # Test POST method (matching the proxy)
        payload = {
            "athlete_id": TEST_ATHLETE_ID,
            "athlete_main_id": TEST_ATHLETE_MAIN_ID,
            "video_type": TEST_VIDEO_TYPE,
            "sport_alias": TEST_SPORT
        }

        response = await client.post(
            f"{BASE_URL}/api/v1/video/seasons",
            json=payload
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "seasons" in data

        logger.info(f"✅ Seasons endpoint returned {len(data['seasons'])} seasons")

        # Verify season format matches Python client
        if data["seasons"]:
            season = data["seasons"][0]
            assert "value" in season  # e.g., "highschool:18249"
            assert "label" in season  # e.g., "'25-'26 - Junior Year..."
            assert ":" in season["value"]  # Verify colon-separated format
            logger.info(f"   Sample season: {season['label']} = {season['value']}")

        return data


async def test_seasons_requires_athlete_main_id():
    """Test that seasons endpoint requires athlete_main_id"""
    async with httpx.AsyncClient() as client:
        # Missing athlete_main_id should return 400
        response = await client.get(
            f"{BASE_URL}/api/v1/video/seasons/{TEST_ATHLETE_ID}",
            params={
                "sport": TEST_SPORT,
                "video_type": TEST_VIDEO_TYPE
                # Missing athlete_main_id
            }
        )

        # Should fail with 422 (validation error) or 400 (bad request)
        assert response.status_code in [400, 422]
        logger.info(f"✅ Correctly rejects request without athlete_main_id: {response.status_code}")
        return response.json()


async def test_video_submit_validation():
    """Test video submission endpoint validates required fields"""
    async with httpx.AsyncClient() as client:
        # Missing required fields should fail validation
        payload = {
            "athlete_id": TEST_ATHLETE_ID,
            # Missing: athlete_main_id, video_url, video_type, season, sport
        }

        response = await client.post(
            f"{BASE_URL}/api/v1/video/submit",
            json=payload
        )

        # Should fail with 422 (validation error)
        assert response.status_code == 422
        logger.info(f"✅ Correctly validates video submission payload")
        return response.json()


async def run_tests():
    """Run all integration tests"""
    logger.info("Starting NPID FastAPI Integration Tests...")
    logger.info("=" * 60)

    try:
        # Test 1: Health check
        logger.info("\n[Test 1] Health Endpoint")
        await test_health()

        # Test 2: Seasons endpoint
        logger.info("\n[Test 2] Seasons Endpoint (Form-Encoded)")
        await test_seasons_endpoint()

        # Test 3: athlete_main_id requirement
        logger.info("\n[Test 3] athlete_main_id Requirement")
        await test_seasons_requires_athlete_main_id()

        # Test 4: Video submission validation
        logger.info("\n[Test 4] Video Submission Validation")
        await test_video_submit_validation()

        logger.info("\n" + "=" * 60)
        logger.info("✅ All tests passed!")

    except AssertionError as e:
        logger.error(f"\n❌ Test failed: {e}")
        raise
    except Exception as e:
        logger.error(f"\n❌ Unexpected error: {e}")
        raise


if __name__ == "__main__":
    print("\n🧪 NPID FastAPI Integration Tests")
    print("Ensure server is running: uvicorn main:app --reload --port 8000\n")

    asyncio.run(run_tests())
