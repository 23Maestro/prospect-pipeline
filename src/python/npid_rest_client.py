import requests
from bs4 import BeautifulSoup
import logging

logger = logging.getLogger(__name__)

class NpidRestClient:
    """REST API client for Prospect ID assignment operations"""
    
    def __init__(self, session_cookies):
        self.session = requests.Session()
        self.session.cookies.update(session_cookies)
        self.base_url = 'https://dashboard.nationalpid.com'
        self.owner_id = '1408164'  # Jerami Singleton
    
    def get_csrf_token(self):
        """Extract CSRF token from cookies"""
        return self.session.cookies.get('XSRF-TOKEN', '')
    
    def assign_thread(self, message_id, email, stage, status):
        """
        Assign video team inbox thread to Jerami Singleton
        
        Flow:
        1. Check modal for pre-filled data (student email = instant)
        2. If empty, search with searchfor=parent
        3. Submit assignment with Jerami as owner
        
        Args:
            message_id: Thread message ID
            email: Contact email (extracted from inbox)
            stage: Video progress stage ("In Queue", "On Hold", etc)
            status: Video progress status ("HUDL", "Dropbox", etc)
        
        Returns:
            dict: {'success': bool, 'contact_id': str, 'athlete_id': str}
        """
        
        logger.info(f"Starting assignment for message {message_id}")
        
        # Step 1: Get modal data (checks if student email with pre-filled data)
        try:
            modal_response = self.session.get(
                f'{self.base_url}/rulestemplates/template/assignemailtovideoteam',
                params={'messageid': message_id}
            )
            modal_response.raise_for_status()
        except Exception as e:
            logger.error(f"Failed to fetch modal: {e}")
            return {'success': False, 'error': str(e)}
        
        # Parse modal HTML
        soup = BeautifulSoup(modal_response.text, 'html.parser')
        
        contact_task_input = soup.find('input', {'id': 'contacttask'})
        contact_task = contact_task_input.get('value', '').strip() if contact_task_input else ''
        
        athlete_main_id_input = soup.find('input', {'id': 'athletemainid'})
        athlete_main_id = athlete_main_id_input.get('value', '').strip() if athlete_main_id_input else ''
        
        # STUDENT EMAIL - Pre-filled data (instant assignment)
        if contact_task and athlete_main_id:
            logger.info(f"✅ STUDENT EMAIL - Instant assignment (contact_id={contact_task}, athlete_id={athlete_main_id})")
            
            return self._submit_assignment(
                message_id=message_id,
                contact_id=contact_task,
                athlete_id=athlete_main_id,
                email=email,
                contact_for='athlete',
                stage=stage,
                status=status
            )
        
        # PARENT EMAIL - Must search with searchfor=parent
        else:
            logger.info(f"⚠️ PARENT EMAIL - Searching for {email}")
            
            try:
                search_response = self.session.get(
                    f'{self.base_url}/templatecalendaraccesscontactslist',
                    params={
                        'search': email,
                        'searchfor': 'parent'
                    }
                )
                search_response.raise_for_status()
            except Exception as e:
                logger.error(f"Search failed: {e}")
                return {'success': False, 'error': f'Search failed: {str(e)}'}
            
            # Parse search results for radio button with student data
            soup = BeautifulSoup(search_response.text, 'html.parser')
            radio = soup.find('input', {'class': 'contactselected', 'type': 'radio'})
            
            if not radio:
                logger.error(f"No data found for parent email: {email}")
                return {'success': False, 'error': f'No student data found for {email}'}
            
            contact_id = radio.get('contactid', '')
            athlete_id = radio.get('athletemainid', '')
            
            logger.info(f"✅ Found student data (contact_id={contact_id}, athlete_id={athlete_id})")
            
            return self._submit_assignment(
                message_id=message_id,
                contact_id=contact_id,
                athlete_id=athlete_id,
                email=email,
                contact_for='parent',
                stage=stage,
                status=status
            )
    
    def _submit_assignment(self, message_id, contact_id, athlete_id, email, contact_for, stage, status):
        """
        Submit assignment with Jerami Singleton as owner
        
        Returns:
            dict: {'success': bool, 'contact_id': str, 'athlete_id': str}
        """
        
        logger.info(f"Submitting assignment: message={message_id}, owner={self.owner_id}, stage={stage}, status={status}")
        
        try:
            response = self.session.post(
                f'{self.base_url}/videoteammsg/assignvideoteam',
                data={
                    'token': self.get_csrf_token(),
                    'contacttask': contact_id,
                    'athletemainid': athlete_id,
                    'messageid': message_id,
                    'videoscoutassignedto': self.owner_id,  # Jerami Singleton (IMPERATIVE)
                    'contactfor': contact_for,  # 'athlete' or 'parent'
                    'contact': email,
                    'videoprogressstage': stage,  # "In Queue", "On Hold", etc
                    'videoprogressstatus': status  # "HUDL", "Dropbox", etc
                }
            )
            response.raise_for_status()
            
            result = response.json()
            logger.info(f"✅ Assignment successful: {result}")
            
            return {
                'success': True,
                'contact_id': contact_id,
                'athlete_id': athlete_id,
                'message_id': message_id,
                'owner': self.owner_id
            }
            
        except Exception as e:
            logger.error(f"Assignment submission failed: {e}")
            return {'success': False, 'error': str(e)}
