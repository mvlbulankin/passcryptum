from django.core.management.base import BaseCommand

from api.models import UserServices


class Command(BaseCommand):
    help = 'Delete public_key'


    def add_arguments(self, parser):
        parser.add_argument('public_key', type=str, help='Public key')


    def handle(self, *args, **kwargs):
        public_key = kwargs['public_key']
        
        try:
            user_service = UserServices.objects.get(public_key=public_key)
            user_service.delete()
            self.stdout.write(self.style.SUCCESS(f'Public key "{public_key}" has been deleted successfully.'))
        except UserServices.DoesNotExist:
            self.stdout.write(self.style.ERROR(f'Public key "{public_key}" does not exist.'))
