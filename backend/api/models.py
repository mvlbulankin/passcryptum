from django.db import models


class UserServices(models.Model):
    public_key = models.CharField(
        primary_key=True,
        max_length=256,
        unique=True,
    )
    encrypted_services = models.TextField(
        editable=True,
        null=True,
        blank=True,
    )

    class Meta:
        verbose_name = "User Services"
        verbose_name_plural = "User Services"

    def __str__(self):
        return self.public_key
