from django.core.management.base import BaseCommand

from profiles.models import Profile


class Command(BaseCommand):
    help = "Add public_key"

    def add_arguments(self, parser):
        parser.add_argument("public_key", type=str, help="Public key")

    def handle(self, *args, **kwargs):
        public_key = kwargs["public_key"]
        profile, created = Profile.objects.get_or_create(
            public_key=public_key
        )

        if created:
            self.stdout.write(
                self.style.SUCCESS(
                    f'Public key "{public_key}" has been added successfully'
                )
            )
        else:
            self.stdout.write(
                self.style.WARNING(f'Public key "{public_key}" already exists')
            )
