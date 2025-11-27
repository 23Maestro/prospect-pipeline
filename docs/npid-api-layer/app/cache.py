"""
Simple in-memory cache for athlete data.
Eliminates repeated lookups for the same athlete within a session.
"""

from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)


class AthleteCache:
    """
    Simple TTL cache for athlete data.
    
    Stores resolved athlete identifiers to avoid repeated API calls.
    Default TTL is 30 minutes - athlete data doesn't change often.
    """
    
    def __init__(self, ttl_minutes: int = 30):
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._ttl = timedelta(minutes=ttl_minutes)
        
    def get(self, key: str) -> Optional[Any]:
        """Get cached value if not expired."""
        if key not in self._cache:
            return None
            
        entry = self._cache[key]
        if datetime.now() - entry["timestamp"] > self._ttl:
            del self._cache[key]
            logger.debug(f"🗑️ Cache expired for {key}")
            return None
            
        return entry["value"]
        
    def set(self, key: str, value: Any) -> None:
        """Store value with timestamp."""
        self._cache[key] = {
            "value": value,
            "timestamp": datetime.now()
        }
        logger.debug(f"📦 Cached {key}")
        
    def invalidate(self, key: str) -> None:
        """Remove specific key from cache."""
        if key in self._cache:
            del self._cache[key]
            logger.debug(f"🗑️ Invalidated {key}")
            
    def clear(self) -> None:
        """Clear entire cache."""
        self._cache.clear()
        logger.info("🗑️ Cache cleared")
        
    def stats(self) -> Dict[str, int]:
        """Get cache statistics."""
        now = datetime.now()
        valid = sum(1 for e in self._cache.values() if now - e["timestamp"] <= self._ttl)
        return {
            "total_entries": len(self._cache),
            "valid_entries": valid,
            "expired_entries": len(self._cache) - valid
        }


# Global cache instance
athlete_cache = AthleteCache()
