from rest_framework import serializers

from .models import UserServices


class UserServicesSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserServices
        fields = ["public_key", "encrypted_services"]


class ServicesSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserServices
        fields = ["encrypted_services"]
