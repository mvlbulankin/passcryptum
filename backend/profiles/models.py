from django.db import models


class Profile(models.Model):
    public_key = models.CharField(
        primary_key=True,
        max_length=256,
        unique=True,
    )
    services = models.TextField(
        null=True,
        blank=True,
    )

    class Meta:
        verbose_name = 'Profile'
        verbose_name_plural = 'Profiles'
