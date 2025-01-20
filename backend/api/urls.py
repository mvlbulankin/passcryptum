from django.urls import path
from .views import UserServicesView


urlpatterns = [
    path('userservices/', UserServicesView.as_view(), name='user-services'),
]
