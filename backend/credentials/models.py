from django.db import models

from profiles.models import Profile


class Credential(models.Model):
    profile = models.ForeignKey(
        Profile,
        on_delete=models.CASCADE,
    )
    pin = models.CharField(max_length=256)
    protector = models.CharField(max_length=256)
    entropy = models.TextField(
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Credential"
        verbose_name_plural = "Credentials"
