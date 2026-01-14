"""
Craft Tasks Router
External API integration for Craft Blocks task tracking.
Does NOT use LegacyTranslator - direct external API calls.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List
from enum import Enum
import httpx
import logging

router = APIRouter(tags=["craft"])
logger = logging.getLogger(__name__)

# Craft API Configuration
CRAFT_BASE_URL = "https://connect.craft.do/links/LmdXrrOfTDC/api/v1"
CRAFT_BLOCK_IDS = {
    "in_queue": "986E3F8E-B6E4-451F-88EF-2E0341FA4209",
    "email_follow_up": "4BD2BA4E-EF33-4E1C-848A-3F948741CD26",
    "dropbox_folders": "8594BD42-BA6B-4416-879F-FFC4F63273F4",
}


class CraftTaskType(str, Enum):
    """Task block types in Craft."""
    IN_QUEUE = "in_queue"
    EMAIL_FOLLOW_UP = "email_follow_up"
    DROPBOX_FOLDERS = "dropbox_folders"


class CreateCraftTaskRequest(BaseModel):
    """Request to create a task in Craft."""
    athlete_name: str = Field(..., description="Athlete name for task title")
    task_type: CraftTaskType = Field(..., description="Which Craft block to add to")
    due_date: Optional[str] = Field(None, description="ISO date string (YYYY-MM-DD) for schedule")
    notes: Optional[str] = Field(None, description="Additional notes for task")


class CreateCraftTaskResponse(BaseModel):
    """Response from task creation."""
    success: bool
    task_id: Optional[str] = None
    message: str


class DeleteCraftTaskRequest(BaseModel):
    """Request to delete a task from Craft."""
    athlete_name: str = Field(..., description="Athlete name to search for")
    task_type: CraftTaskType = Field(..., description="Which block to search in")


class DeleteCraftTaskResponse(BaseModel):
    """Response from task deletion."""
    success: bool
    deleted_count: int
    message: str


class SearchCraftTasksRequest(BaseModel):
    """Request to search tasks in Craft."""
    athlete_name: str = Field(..., description="Athlete name to search")
    task_types: Optional[List[CraftTaskType]] = Field(None, description="Block types to search")


class CraftTask(BaseModel):
    """A task from Craft."""
    id: str
    content: str
    task_type: CraftTaskType
    state: str
    schedule_date: Optional[str] = None


class SearchCraftTasksResponse(BaseModel):
    """Response from task search."""
    success: bool
    tasks: List[CraftTask]
    count: int


def get_craft_client() -> httpx.AsyncClient:
    """Create httpx client for Craft API."""
    return httpx.AsyncClient(
        base_url=CRAFT_BASE_URL,
        timeout=15.0,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
    )


@router.post("/create", response_model=CreateCraftTaskResponse)
async def create_craft_task(payload: CreateCraftTaskRequest):
    """
    Create a task in Craft under the specified block.

    Task format: Markdown text with listStyle: "task"
    Never raises HTTPException - returns success: false on errors.
    """
    block_id = CRAFT_BLOCK_IDS.get(payload.task_type.value)
    if not block_id:
        return CreateCraftTaskResponse(
            success=False,
            message=f"Unknown task type: {payload.task_type}"
        )

    logger.info(f"Creating Craft task: {payload.athlete_name} ({payload.task_type.value})")

    # Build task content
    task_content = payload.athlete_name
    if payload.notes:
        task_content += f"\n{payload.notes}"

    # Build task block payload per Craft API
    task_block = {
        "type": "text",
        "markdown": task_content,
        "listStyle": "task",
        "taskInfo": {
            "state": "todo"
        }
    }

    if payload.due_date:
        task_block["taskInfo"]["scheduleDate"] = payload.due_date

    # Craft API payload
    craft_payload = {
        "blocks": [task_block],
        "position": {
            "position": "end",
            "pageId": block_id
        }
    }

    try:
        async with get_craft_client() as client:
            response = await client.post("/blocks", json=craft_payload)

            if response.status_code in [200, 201]:
                data = response.json()
                # Extract created block ID from response
                items = data.get("items", [])
                task_id = items[0].get("id") if items else None
                logger.info(f"Craft task created: {task_id}")
                return CreateCraftTaskResponse(
                    success=True,
                    task_id=task_id,
                    message=f"Task created for {payload.athlete_name}"
                )
            else:
                logger.warning(f"Craft API error: {response.status_code} - {response.text}")
                return CreateCraftTaskResponse(
                    success=False,
                    message=f"Craft API error: {response.status_code}"
                )
    except Exception as e:
        logger.error(f"Craft task creation failed: {e}")
        return CreateCraftTaskResponse(
            success=False,
            message=f"Failed to create task: {str(e)}"
        )


@router.delete("/complete", response_model=DeleteCraftTaskResponse)
async def delete_craft_task(payload: DeleteCraftTaskRequest):
    """
    Delete task(s) by athlete name from specified block.
    Searches for matching tasks and deletes them.
    Never raises HTTPException - returns success: false on errors.
    """
    block_id = CRAFT_BLOCK_IDS.get(payload.task_type.value)
    if not block_id:
        return DeleteCraftTaskResponse(
            success=False,
            deleted_count=0,
            message=f"Unknown task type: {payload.task_type}"
        )

    logger.info(f"Deleting Craft task: {payload.athlete_name} ({payload.task_type.value})")

    try:
        async with get_craft_client() as client:
            # 1. Fetch block with children
            search_response = await client.get(
                "/blocks",
                params={"id": block_id, "maxDepth": 1}
            )

            if search_response.status_code != 200:
                return DeleteCraftTaskResponse(
                    success=False,
                    deleted_count=0,
                    message=f"Failed to search tasks: {search_response.status_code}"
                )

            block_data = search_response.json()
            children = block_data.get("content", [])

            # 2. Find matching tasks (case-insensitive name search)
            matching_ids = []
            search_name = payload.athlete_name.lower()
            for child in children:
                content = child.get("markdown", "").lower()
                if search_name in content:
                    matching_ids.append(child.get("id"))

            if not matching_ids:
                logger.info(f"No matching tasks found for {payload.athlete_name}")
                return DeleteCraftTaskResponse(
                    success=True,
                    deleted_count=0,
                    message="No matching tasks found"
                )

            # 3. Delete matching tasks
            delete_response = await client.delete(
                "/blocks",
                json={"blockIds": matching_ids}
            )

            if delete_response.status_code in [200, 204]:
                logger.info(f"Deleted {len(matching_ids)} task(s) for {payload.athlete_name}")
                return DeleteCraftTaskResponse(
                    success=True,
                    deleted_count=len(matching_ids),
                    message=f"Deleted {len(matching_ids)} task(s)"
                )
            else:
                return DeleteCraftTaskResponse(
                    success=False,
                    deleted_count=0,
                    message=f"Delete failed: {delete_response.status_code}"
                )

    except Exception as e:
        logger.error(f"Craft task deletion failed: {e}")
        return DeleteCraftTaskResponse(
            success=False,
            deleted_count=0,
            message=f"Failed to delete task: {str(e)}"
        )


@router.post("/search", response_model=SearchCraftTasksResponse)
async def search_craft_tasks(payload: SearchCraftTasksRequest):
    """
    Search for tasks across specified block types.
    Used to check for duplicates before creation.
    Never raises HTTPException - returns empty on error.
    """
    task_types = payload.task_types or list(CraftTaskType)
    all_tasks: List[CraftTask] = []

    try:
        async with get_craft_client() as client:
            for task_type in task_types:
                block_id = CRAFT_BLOCK_IDS.get(task_type.value)
                if not block_id:
                    continue

                response = await client.get(
                    "/blocks",
                    params={"id": block_id, "maxDepth": 1}
                )

                if response.status_code != 200:
                    continue

                block_data = response.json()
                children = block_data.get("content", [])
                search_name = payload.athlete_name.lower()

                for child in children:
                    content = child.get("markdown", "")
                    if search_name in content.lower():
                        task_info = child.get("taskInfo", {})
                        all_tasks.append(CraftTask(
                            id=child.get("id", ""),
                            content=content,
                            task_type=task_type,
                            state=task_info.get("state", "unknown"),
                            schedule_date=task_info.get("scheduleDate")
                        ))

        return SearchCraftTasksResponse(
            success=True,
            tasks=all_tasks,
            count=len(all_tasks)
        )
    except Exception as e:
        logger.error(f"Craft task search failed: {e}")
        return SearchCraftTasksResponse(
            success=False,
            tasks=[],
            count=0
        )
