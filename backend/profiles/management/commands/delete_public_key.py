from django.core.management.base import BaseCommand

from profiles.models import Profile


class Command(BaseCommand):
    help = "Delete public_key"

    def add_arguments(self, parser):
        parser.add_argument("public_key", type=str, help="Public key")

    def handle(self, *args, **kwargs):
        public_key = kwargs["public_key"]

        try:
            profile = Profile.objects.get(public_key=public_key)
            profile.delete()
            self.stdout.write(
                self.style.SUCCESS(
                    f'Public key "{public_key}" has been deleted successfully'
                )
            )
        except Profile.DoesNotExist:
            self.stdout.write(
                self.style.ERROR(f'Public key "{public_key}" does not exist')
            )
