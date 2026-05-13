"""
Tasks Router
FastAPI endpoints for athlete tasks.
"""

from fastapi import APIRouter, HTTPException, Request
import logging
from typing import Dict, Any, List, Optional

from app.models.schemas import (
    TaskListRequest,
    TaskListResponse,
    TaskPopupRequest,
    TaskPopupResponse,
    TaskUpdateRequest,
    TaskUpdateResponse,
    TaskCreateCompletedRequest,
    TaskCreateCompletedResponse,
    TaskCompleteRequest,
    TaskCompleteResponse,
    TaskCallAttempt3SentRequest,
    TaskCallAttempt3SentResponse,
    TaskFollowUpMessageSentRequest,
    TaskFollowUpMessageSentResponse,
)
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession

router = APIRouter(tags=["tasks"])
logger = logging.getLogger(__name__)


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


def _sanitize_form_data(form_data: Dict[str, Any]) -> Dict[str, Any]:
    sanitized: Dict[str, Any] = {}
    for key, value in form_data.items():
        if key == "_token":
            sanitized[key] = f"len:{len(str(value))}"
        else:
            text = str(value)
            sanitized[key] = text if len(text) <= 120 else f"{text[:120]}..."
    return sanitized


def _normalize_text(value: str) -> str:
    return (value or "").strip().lower()


def _truncate(value: Any, limit: int = 120) -> str:
    text = str(value) if value is not None else ""
    return text if len(text) <= limit else f"{text[:limit]}..."


def _summarize_tasks(tasks: List[Dict[str, Any]], limit: int = 5) -> List[Dict[str, Any]]:
    summaries: List[Dict[str, Any]] = []
    for task in tasks[:limit]:
        summaries.append({
            "task_id": task.get("task_id"),
            "title": _truncate(task.get("title")),
            "assigned_owner": _truncate(task.get("assigned_owner")),
            "description": _truncate(task.get("description"))
        })
    return summaries


def _is_incomplete_task(task: Dict[str, Any]) -> bool:
    return not _normalize_text(task.get("completion_date", ""))


def _pick_task_from_candidates(tasks: List[Dict[str, Any]], payload: TaskCompleteRequest) -> Optional[Dict[str, Any]]:
    if payload.task_id:
        exact_match = next((task for task in tasks if str(task.get("task_id", "")) == str(payload.task_id)), None)
        if exact_match:
            return exact_match
        return None

    title_matches = [
        task for task in tasks
        if _normalize_text(task.get("title", "")) == _normalize_text(payload.task_title)
        and task.get("task_id")
    ]

    if not title_matches:
        return None

    owner_matches = [
        task for task in title_matches
        if _normalize_text(task.get("assigned_owner", "")) == _normalize_text(payload.assigned_owner)
    ]
    candidate_pool = owner_matches or title_matches
    incomplete_matches = [task for task in candidate_pool if _is_incomplete_task(task)]
    return (incomplete_matches or candidate_pool)[0] if (incomplete_matches or candidate_pool) else None


def _summarize_form_fields(form_data: Dict[str, Any], fields: List[str]) -> Dict[str, Any]:
    summary: Dict[str, Any] = {}
    for field in fields:
        if field in form_data:
            summary[field] = _truncate(form_data.get(field), 160)
    return summary


def _diff_form_data(before: Dict[str, Any], after: Dict[str, Any]) -> Dict[str, Any]:
    changed: Dict[str, Any] = {}
    keys = set(before.keys()) | set(after.keys())
    for key in keys:
        before_val = before.get(key)
        after_val = after.get(key)
        if str(before_val) != str(after_val):
            changed[key] = _truncate(after_val, 160)
    return changed


async def _verify_sales_stage_persisted(
    session: NPIDSession,
    translator: LegacyTranslator,
    athlete_id: str,
    expected_stage: str,
) -> str:
    endpoint, params = translator.sales_stage_options_to_legacy(athlete_id=athlete_id)
    response = await session.get(endpoint, params=params)
    result = translator.parse_sales_stage_options_response(response.text)
    selected_stage = str(
        result.get("selected_label") or result.get("selected_value") or ""
    ).strip()

    if not selected_stage or not translator.sales_stage_labels_match(selected_stage, expected_stage):
        logger.error(
            "❌ Sales stage did not persist athlete_id=%s expected=%s selected=%s status=%s content_type=%s preview=%s",
            athlete_id,
            expected_stage,
            selected_stage or "Select",
            response.status_code,
            response.headers.get("content-type"),
            _truncate(response.text, 200),
        )
        raise HTTPException(
            status_code=502,
            detail=f"Sales stage did not persist; selected is {selected_stage or 'Select'}",
        )

    logger.info(
        "✅ Sales stage verified athlete_id=%s selected=%s status=%s",
        athlete_id,
        selected_stage,
        response.status_code,
    )
    return selected_stage


async def _record_follow_up_message_sent(
    session: NPIDSession,
    translator: LegacyTranslator,
    payload: TaskFollowUpMessageSentRequest,
) -> TaskFollowUpMessageSentResponse:
    stage_endpoint, stage_data = translator.sales_stage_update_to_legacy(
        athlete_main_id=payload.athlete_main_id,
        athlete_id=payload.athlete_id,
        stage=payload.stage,
    )
    stage_response = await session.post(stage_endpoint, data=stage_data)
    stage_preview = (stage_response.text or "")[:200]
    logger.info(
        "📥 Follow-up sales stage response status=%s content_type=%s preview=%s",
        stage_response.status_code,
        stage_response.headers.get("content-type"),
        _truncate(stage_preview, 200),
    )
    if stage_response.status_code >= 400:
        raise HTTPException(
            status_code=stage_response.status_code,
            detail=stage_preview or f"Sales stage update HTTP {stage_response.status_code}",
        )
    persisted_stage = await _verify_sales_stage_persisted(
        session=session,
        translator=translator,
        athlete_id=payload.athlete_id,
        expected_stage=stage_data.get("stage", payload.stage),
    )

    popup_endpoint, popup_params = translator.task_popup_to_legacy(payload.task_id)
    popup_response = await session.get(popup_endpoint, params=popup_params)
    popup_result = translator.parse_task_popup_response(popup_response.text)
    form_data = popup_result.get("form_data", {})

    updated_form_data = translator.apply_follow_up_message_sent(
        form_data=form_data,
        athlete_id=payload.athlete_id,
        athlete_main_id=payload.athlete_main_id,
        completed_date=payload.completed_date,
        completed_time=payload.completed_time,
        task_title=payload.task_title,
        description=payload.description,
        assigned_to=payload.assigned_to,
    )

    required_fields = [
        "existingtask",
        "tasktitle",
        "taskdescription",
        "contact_task",
        "athlete_main_id",
        "completedate",
        "completed_time",
        "assignedto",
    ]
    missing_fields = [field for field in required_fields if not str(updated_form_data.get(field) or "").strip()]
    changed_fields = _diff_form_data(form_data, updated_form_data)

    if missing_fields:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required task fields: {', '.join(missing_fields)}",
        )

    logger.info(
        "🧾 Follow-up form summary=%s",
        _sanitize_form_data(updated_form_data),
    )
    logger.info(
        "🧾 Follow-up changed fields=%s",
        _sanitize_form_data(changed_fields),
    )

    update_endpoint, final_form_data = translator.task_update_to_legacy(updated_form_data)
    update_response = await session.post(update_endpoint, data=final_form_data)
    update_result = translator.parse_task_update_response(update_response.text)

    if update_result.get("success"):
        return TaskFollowUpMessageSentResponse(
            success=True,
            task_id=payload.task_id,
            stage=persisted_stage or payload.stage,
            message=update_result.get("message", "Follow-up recorded"),
            raw_response=update_result.get("raw"),
        )

    raise HTTPException(
        status_code=400,
        detail=update_result.get("message", "Follow-up update failed"),
    )


@router.post("/list", response_model=TaskListResponse)
async def list_tasks(request: Request, payload: TaskListRequest):
    """
    Fetch tasks list for an athlete contact.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"📥 Fetching tasks list for athlete {payload.athlete_id}")

    try:
        endpoint, params = translator.tasks_list_to_legacy(
            payload.athlete_id, payload.athlete_main_id
        )
        response = await session.get(endpoint, params=params)
        logger.info(
            f"📥 Tasks list response status={response.status_code} content_type={response.headers.get('content-type')}"
        )
        result = translator.parse_tasks_list_response(response.text)
        tasks = result.get("tasks", [])
        logger.info(
            "📊 Tasks parsed count=%s sample=%s",
            len(tasks),
            _summarize_tasks(tasks)
        )
        return TaskListResponse(success=True, count=len(tasks), tasks=tasks)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"❌ Tasks list error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/popup", response_model=TaskPopupResponse)
async def task_popup(request: Request, payload: TaskPopupRequest):
    """
    Fetch task popup form data by task id.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"📥 Fetching task popup for task {payload.task_id}")

    try:
        endpoint, params = translator.task_popup_to_legacy(payload.task_id)
        response = await session.get(endpoint, params=params)
        logger.info(
            f"📥 Task popup response status={response.status_code} content_type={response.headers.get('content-type')}"
        )
        result = translator.parse_task_popup_response(response.text)
        form_data = result.get("form_data", {})
        checkbox_fields = result.get("checkbox_fields", [])
        token_len = len(str(form_data.get("_token", "")))
        logger.info(
            "🧾 Task popup form keys=%s checkbox_fields=%s token_len=%s",
            ",".join(sorted(form_data.keys())),
            ",".join(checkbox_fields),
            token_len
        )
        logger.info(
            "🧾 Task popup field summary=%s",
            _summarize_form_fields(
                form_data,
                [
                    "existingtask",
                    "tasktitle",
                    "taskdescription",
                    "duedate",
                    "duetime",
                    "completedate",
                    "completed_time",
                    "assignedto",
                    "contact_task",
                    "athlete_main_id"
                ]
            )
        )
        return TaskPopupResponse(
            success=True,
            form_data=form_data,
            checkbox_fields=checkbox_fields
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"❌ Task popup error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/update", response_model=TaskUpdateResponse)
async def update_task(request: Request, payload: TaskUpdateRequest):
    """
    Update an exact legacy task via popup -> addtask roundtrip.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "📝 Updating task contact_task=%s athlete_main_id=%s task_id=%s due_date=%s due_time=%s task_title=%s",
        payload.contact_task,
        payload.athlete_main_id,
        payload.task_id,
        payload.due_date,
        payload.due_time,
        payload.task_title,
    )

    try:
        endpoint, params = translator.task_popup_to_legacy(payload.task_id)
        popup_response = await session.get(endpoint, params=params)
        popup_result = translator.parse_task_popup_response(popup_response.text)
        form_data = popup_result.get("form_data", {})
        checkbox_fields = popup_result.get("checkbox_fields", [])

        updated_form_data = translator.apply_task_update(
            form_data=form_data,
            athlete_id=payload.contact_task,
            athlete_main_id=payload.athlete_main_id,
            task_title=payload.task_title,
            description=payload.description,
            due_date=payload.due_date,
            due_time=payload.due_time,
            checkbox_fields=checkbox_fields,
        )

        if not str(updated_form_data.get("existingtask") or "").strip():
            updated_form_data["existingtask"] = payload.task_id
        if not str(updated_form_data.get("contact_task") or "").strip():
            updated_form_data["contact_task"] = payload.contact_task
        if not str(updated_form_data.get("athlete_main_id") or "").strip():
            updated_form_data["athlete_main_id"] = payload.athlete_main_id

        required_fields = ["existingtask", "tasktitle", "taskdescription", "contact_task", "athlete_main_id"]
        missing_fields = [field for field in required_fields if field not in updated_form_data]
        changed_fields = _diff_form_data(form_data, updated_form_data)

        if "existingtask" in missing_fields:
            raise HTTPException(status_code=400, detail="Missing existingtask in task form")

        logger.info(
            "🧾 Task update form summary=%s",
            _sanitize_form_data(updated_form_data),
        )
        logger.info("🧾 Task update changed fields=%s", _sanitize_form_data(changed_fields))

        endpoint, final_form_data = translator.task_update_to_legacy(updated_form_data)
        update_response = await session.post(endpoint, data=final_form_data)
        logger.info(
            "📥 Task update response status=%s content_type=%s",
            update_response.status_code,
            update_response.headers.get("content-type"),
        )
        update_result = translator.parse_task_update_response(update_response.text)

        if update_result.get("success"):
            return TaskUpdateResponse(
                success=True,
                task_id=payload.task_id,
                message=update_result.get("message", "Task updated"),
                raw_response=update_result.get("raw"),
            )

        raise HTTPException(status_code=400, detail=update_result.get("message", "Task update failed"))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"❌ Task update error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/create-completed", response_model=TaskCreateCompletedResponse)
async def create_completed_task(request: Request, payload: TaskCreateCompletedRequest):
    """
    Create a custom legacy task from the new-task popup and immediately mark it completed.
    """
    session = get_session(request)
    translator = LegacyTranslator()
    contact_task = payload.contact_task or payload.athlete_id

    logger.info(
        "➕ Creating completed task athlete_id=%s athlete_main_id=%s contact_task=%s task_title=%s assigned_to=%s completed_date=%s completed_time=%s",
        payload.athlete_id,
        payload.athlete_main_id,
        contact_task,
        payload.task_title,
        payload.assigned_to,
        payload.completed_date,
        payload.completed_time,
    )

    try:
        endpoint, params = translator.task_create_popup_to_legacy(
            adminathlete=contact_task,
            athlete_main_id=payload.athlete_main_id,
        )
        popup_response = await session.get(endpoint, params=params)
        logger.info(
            "📥 Create task popup response status=%s content_type=%s",
            popup_response.status_code,
            popup_response.headers.get("content-type"),
        )
        popup_result = translator.parse_task_popup_response(popup_response.text)
        form_data = popup_result.get("form_data", {})

        created_form_data = translator.apply_completed_task_create(
            form_data=form_data,
            athlete_id=contact_task,
            athlete_main_id=payload.athlete_main_id,
            task_title=payload.task_title,
            description=payload.description,
            due_date=payload.due_date,
            due_time=payload.due_time,
            completed_date=payload.completed_date,
            completed_time=payload.completed_time,
            assigned_to=payload.assigned_to,
        )

        required_fields = [
            "existingtask",
            "tasktitle",
            "taskdescription",
            "contact_task",
            "athlete_main_id",
            "completedate",
            "completed_time",
            "assignedto",
        ]
        missing_fields = [field for field in required_fields if not str(created_form_data.get(field) or "").strip()]
        changed_fields = _diff_form_data(form_data, created_form_data)

        if missing_fields:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required task fields: {', '.join(missing_fields)}",
            )

        logger.info("🧾 Create task form summary=%s", _sanitize_form_data(created_form_data))
        logger.info("🧾 Create task changed fields=%s", _sanitize_form_data(changed_fields))

        endpoint, final_form_data = translator.task_update_to_legacy(created_form_data)
        create_response = await session.post(endpoint, data=final_form_data)
        logger.info(
            "📥 Create task response status=%s content_type=%s",
            create_response.status_code,
            create_response.headers.get("content-type"),
        )
        create_result = translator.parse_task_update_response(create_response.text)

        if not create_result.get("success"):
            raise HTTPException(status_code=400, detail=create_result.get("message", "Task create failed"))

        list_endpoint, list_params = translator.tasks_list_to_legacy(contact_task, payload.athlete_main_id)
        list_response = await session.get(list_endpoint, params=list_params)
        tasks_result = translator.parse_tasks_list_response(list_response.text)
        tasks: List[Dict[str, Any]] = tasks_result.get("tasks", [])
        matching_tasks = [
            task for task in tasks
            if _normalize_text(task.get("title", "")) == _normalize_text(payload.task_title)
            and _normalize_text(task.get("description", "")) == _normalize_text(payload.description)
        ]
        task_id = str(matching_tasks[0].get("task_id") or "").strip() if matching_tasks else None

        return TaskCreateCompletedResponse(
            success=True,
            task_id=task_id,
            message=create_result.get("message", "Task created"),
            raw_response=create_result.get("raw"),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"❌ Task create error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/complete", response_model=TaskCompleteResponse)
async def complete_task(request: Request, payload: TaskCompleteRequest):
    """
    Mark a task complete and update its description.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "✅ Completing task athlete_id=%s athlete_main_id=%s contact_task=%s task_id=%s task_title=%s assigned_owner=%s completed_date=%s completed_time=%s is_completed=%s",
        payload.athlete_id,
        payload.athlete_main_id,
        payload.contact_task,
        payload.task_id,
        payload.task_title,
        payload.assigned_owner,
        payload.completed_date,
        payload.completed_time,
        payload.is_completed
    )

    try:
        task_id = payload.task_id
        target: Optional[Dict[str, Any]] = None

        if payload.task_id:
            logger.info("🎯 Exact task id requested task_id=%s", payload.task_id)
            target = {"task_id": payload.task_id}
        else:
            endpoint, params = translator.tasks_list_to_legacy(
                payload.athlete_id, payload.athlete_main_id
            )
            list_response = await session.get(endpoint, params=params)
            tasks_result = translator.parse_tasks_list_response(list_response.text)
            tasks: List[Dict[str, Any]] = tasks_result.get("tasks", [])
            logger.info(
                "📊 Parsed tasks count=%s sample=%s",
                len(tasks),
                _summarize_tasks(tasks)
            )
            target = _pick_task_from_candidates(tasks, payload)
            logger.info("🔎 Fallback task candidate=%s", _summarize_tasks([target], limit=1) if target else [])

        if not target:
            logger.warning("⚠️ No matching task found")
            raise HTTPException(status_code=404, detail="Task not found for athlete")

        task_id = target.get("task_id", "")
        endpoint, params = translator.task_popup_to_legacy(task_id)
        popup_response = await session.get(endpoint, params=params)
        popup_result = translator.parse_task_popup_response(popup_response.text)
        form_data = popup_result.get("form_data", {})
        checkbox_fields = popup_result.get("checkbox_fields", [])

        updated_form_data = translator.apply_task_completion(
            payload,
            form_data,
            checkbox_fields
        )

        required_fields = ["existingtask", "tasktitle", "taskdescription", "contact_task", "athlete_main_id"]
        missing_fields = [field for field in required_fields if field not in updated_form_data]
        changed_fields = _diff_form_data(form_data, updated_form_data)

        if "existingtask" in missing_fields:
            raise HTTPException(status_code=400, detail="Missing existingtask in task form")

        logger.info(
            "📝 Task update form prepared task_id=%s missing_fields=%s",
            task_id,
            ",".join(missing_fields)
        )
        logger.info("🧾 Task update form summary: %s", _sanitize_form_data(updated_form_data))
        logger.info("🧾 Task update changed fields: %s", _sanitize_form_data(changed_fields))

        endpoint, final_form_data = translator.task_update_to_legacy(updated_form_data)
        update_response = await session.post(endpoint, data=final_form_data)
        logger.info(
            f"📥 Task update response status={update_response.status_code} content_type={update_response.headers.get('content-type')}"
        )
        update_result = translator.parse_task_update_response(update_response.text)

        if update_result.get("success"):
            return TaskCompleteResponse(
                success=True,
                task_id=task_id,
                message=update_result.get("message", "Task updated"),
                raw_response=update_result.get("raw")
            )

        raise HTTPException(status_code=400, detail=update_result.get("message", "Task update failed"))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"❌ Task complete error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/call-attempt-3-sent", response_model=TaskCallAttempt3SentResponse)
async def call_attempt_3_sent(request: Request, payload: TaskCallAttempt3SentRequest):
    """
    After an actual Call Attempt 3 text is sent, update sales stage and the exact legacy task.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "📨 Call Attempt 3 sent athlete_id=%s athlete_main_id=%s task_id=%s stage=%s",
        payload.athlete_id,
        payload.athlete_main_id,
        payload.task_id,
        payload.stage,
    )

    try:
        result = await _record_follow_up_message_sent(
            session=session,
            translator=translator,
            payload=TaskFollowUpMessageSentRequest(
                athlete_id=payload.athlete_id,
                athlete_main_id=payload.athlete_main_id,
                task_id=payload.task_id,
                completed_date=payload.completed_date,
                completed_time=payload.completed_time,
                stage=payload.stage,
                task_title=payload.task_title,
                description=payload.description,
                assigned_to=payload.assigned_to,
            ),
        )
        return TaskCallAttempt3SentResponse(
            success=result.success,
            task_id=result.task_id,
            stage=result.stage,
            message=result.message,
            raw_response=result.raw_response,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"❌ Call Attempt 3 sent error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/follow-up-message-sent", response_model=TaskFollowUpMessageSentResponse)
async def follow_up_message_sent(request: Request, payload: TaskFollowUpMessageSentRequest):
    """
    After an actual voicemail follow-up text is sent, update sales stage and the exact legacy task.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "📨 Follow-up sent athlete_id=%s athlete_main_id=%s task_id=%s stage=%s task_title=%s",
        payload.athlete_id,
        payload.athlete_main_id,
        payload.task_id,
        payload.stage,
        payload.task_title,
    )

    try:
        return await _record_follow_up_message_sent(
            session=session,
            translator=translator,
            payload=payload,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"❌ Follow-up sent error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
